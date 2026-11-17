// Band Watch by M3vrv: the RTL-SDR bridge. The browser can't open a TCP connection, so the
// server connects to rtl_tcp (from the RTL-SDR Blog drivers, which support the Blog V4)
// and passes the raw I/Q samples through; the page does the radio itself (public/js/sdr-dsp.js).
package main

import (
	"bufio"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// rtl_tcp commands Band Watch may send: frequency, sample rate, gain mode, gain, ppm,
// RTL AGC, gain by index, bias tee.
var sdrCommands = map[int]bool{0x01: true, 0x02: true, 0x03: true, 0x04: true, 0x05: true, 0x08: true, 0x09: true, 0x0d: true, 0x0e: true}

const sdrMaxSessions = 2

type sdrBridge struct {
	mu       sync.Mutex
	sessions map[string]net.Conn
	proc     *rtlProc
}

// rtlProc is an rtl_tcp that Band Watch started for the user ("Start rtl_tcp for me").
type rtlProc struct {
	cmd     *exec.Cmd
	args    []string
	path    string
	mu      sync.Mutex
	output  []string
	exited  bool
	exitMsg string
}

func (p *rtlProc) add(line string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.output = append(p.output, line)
	if len(p.output) > 30 {
		p.output = p.output[len(p.output)-30:]
	}
}

func (p *rtlProc) status() map[string]any {
	p.mu.Lock()
	defer p.mu.Unlock()
	return map[string]any{"running": !p.exited, "path": p.path, "args": p.args, "output": append([]string{}, p.output...), "exit": p.exitMsg}
}

var rtlNameRe = regexp.MustCompile(`(?i)^rtl_tcp(\.exe)?$`)

// findRtlTcp returns the rtl_tcp program to run: the one given, or else one next to Band Watch or on the PATH.
func findRtlTcp(given string) (string, string) {
	given = strings.TrimSpace(strings.Trim(given, `"`))
	if given != "" {
		if !rtlNameRe.MatchString(filepath.Base(given)) {
			return "", "That isn't rtl_tcp: choose the rtl_tcp.exe from the RTL-SDR Blog drivers."
		}
		if st, err := os.Stat(given); err != nil || st.IsDir() {
			return "", "rtl_tcp wasn't found at " + given + "."
		}
		return given, ""
	}
	if exe, err := os.Executable(); err == nil {
		for _, name := range []string{"rtl_tcp.exe", "rtl_tcp"} {
			p := filepath.Join(filepath.Dir(exe), name)
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				return p, ""
			}
		}
	}
	if p, err := exec.LookPath("rtl_tcp"); err == nil {
		return p, ""
	}
	return "", "Band Watch couldn't find rtl_tcp. Enter where rtl_tcp.exe is, in Settings > RTL-SDR receiver."
}

func newSdrBridge() *sdrBridge { return &sdrBridge{sessions: map[string]net.Conn{}} }

var sdrAddrRe = regexp.MustCompile(`^([A-Za-z0-9.-]+):(\d{1,5})$`)

// parseSdrAddr accepts this PC or a private (home network) IPv4 address, with a port.
func parseSdrAddr(addr string) (string, bool) {
	m := sdrAddrRe.FindStringSubmatch(strings.TrimSpace(addr))
	if m == nil {
		return "", false
	}
	port, _ := strconv.Atoi(m[2])
	if port < 1 || port > 65535 {
		return "", false
	}
	host := strings.ToLower(m[1])
	if host == "localhost" {
		host = "127.0.0.1"
	}
	parts := strings.Split(host, ".")
	if len(parts) != 4 {
		return "", false
	}
	n := make([]int, 4)
	for i, p := range parts {
		v, err := strconv.Atoi(p)
		if err != nil || v < 0 || v > 255 || len(p) > 3 {
			return "", false
		}
		n[i] = v
	}
	a, b := n[0], n[1]
	if !(a == 127 || a == 10 || (a == 192 && b == 168) || (a == 172 && b >= 16 && b <= 31)) {
		return "", false
	}
	return net.JoinHostPort(host, strconv.Itoa(port)), true
}

func (s *Server) sdrOn() bool { return s.cfg.Desktop || s.cfg.TestHooks }

func (s *Server) handleSdr(w http.ResponseWriter, r *http.Request) {
	if !s.sdrOn() {
		sendJSON(w, 404, errJSON("The RTL-SDR receiver works in Band Watch on your own PC."), nil)
		return
	}
	p := r.URL.Path
	if r.Method == http.MethodGet && p == "/api/sdr" {
		sendJSON(w, 200, map[string]any{"available": true}, nil)
		return
	}
	// Other web sites can't add this header without the browser asking first.
	if r.Header.Get("X-Band-Watch") != "sdr" {
		sendJSON(w, 403, errJSON("missing X-Band-Watch header"), nil)
		return
	}
	switch {
	case r.Method == http.MethodGet && p == "/api/sdr/stream":
		s.sdrStream(w, r)
	case r.Method == http.MethodGet && p == "/api/sdr/launch":
		s.sdrLaunchStatus(w)
	case r.Method == http.MethodPost && p == "/api/sdr/launch":
		s.sdrLaunch(w, r)
	case r.Method == http.MethodPost && p == "/api/sdr/launch/stop":
		s.sdrLaunchStop(w)
	case r.Method == http.MethodPost && p == "/api/sdr/cmd":
		s.sdrCommand(w, r)
	default:
		sendJSON(w, 404, errJSON("not found"), nil)
	}
}

func (s *Server) sdrStream(w http.ResponseWriter, r *http.Request) {
	target, ok := parseSdrAddr(r.URL.Query().Get("addr"))
	if !ok {
		sendJSON(w, 400, errJSON("Use this PC or a home-network address, for example 127.0.0.1:1234."), nil)
		return
	}
	b := s.sdr
	b.mu.Lock()
	busy := len(b.sessions) >= sdrMaxSessions
	b.mu.Unlock()
	if busy {
		sendJSON(w, 429, errJSON("The receiver is already open in another window."), nil)
		return
	}
	conn, err := net.DialTimeout("tcp", target, 8*time.Second)
	if err != nil {
		sendJSON(w, 502, errJSON(fmt.Sprintf("Couldn't connect to rtl_tcp at %s (%s). Is rtl_tcp running?", target, shortNetErr(err))), nil)
		return
	}
	if tc, ok := conn.(*net.TCPConn); ok {
		_ = tc.SetNoDelay(true)
	}
	idb := make([]byte, 16)
	_, _ = rand.Read(idb)
	id := hex.EncodeToString(idb)
	b.mu.Lock()
	b.sessions[id] = conn
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		delete(b.sessions, id)
		b.mu.Unlock()
		conn.Close()
	}()
	// Close the connection when the page goes away.
	go func() { <-r.Context().Done(); conn.Close() }()

	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Type", "application/octet-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-SDR-Session", id)
	w.WriteHeader(200)
	flusher, _ := w.(http.Flusher)
	buf := make([]byte, 64*1024)
	for {
		n, err := conn.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
		}
		if err != nil {
			return
		}
	}
}

func shortNetErr(err error) string {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "refused"):
		return "connection refused"
	case strings.Contains(msg, "timeout"):
		return "no answer"
	}
	return msg
}

func (s *Server) sdrCommand(w http.ResponseWriter, r *http.Request) {
	body, err := readJSON(r, 512)
	if err != nil {
		var qe *QrzError
		if errors.As(err, &qe) {
			sendJSON(w, qe.Status, errJSON(qe.Msg), nil)
		} else {
			sendJSON(w, 400, errJSON("Invalid JSON."), nil)
		}
		return
	}
	id, _ := body["session"].(string)
	s.sdr.mu.Lock()
	conn := s.sdr.sessions[id]
	s.sdr.mu.Unlock()
	if conn == nil {
		sendJSON(w, 404, errJSON("The receiver isn't connected."), nil)
		return
	}
	cmdF, ok1 := body["cmd"].(float64)
	valF, ok2 := body["value"].(float64)
	cmd := int(cmdF)
	if !ok1 || !ok2 || float64(cmd) != cmdF || !sdrCommands[cmd] || valF != float64(int64(valF)) || valF < -0x80000000 || valF > 0xffffffff || (cmd == 0x09 && (valF < 0 || valF > 2)) {
		sendJSON(w, 400, errJSON("bad command"), nil)
		return
	}
	msg := make([]byte, 5)
	msg[0] = byte(cmd)
	binary.BigEndian.PutUint32(msg[1:], uint32(int64(valF)))
	_ = conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
	if _, err := conn.Write(msg); err != nil {
		sendJSON(w, 502, errJSON("The receiver connection was lost."), nil)
		return
	}
	sendJSON(w, 200, map[string]any{"ok": true}, nil)
}

func (s *Server) sdrLaunchStatus(w http.ResponseWriter) {
	s.sdr.mu.Lock()
	p := s.sdr.proc
	s.sdr.mu.Unlock()
	if p == nil {
		sendJSON(w, 200, map[string]any{"running": false}, nil)
		return
	}
	sendJSON(w, 200, p.status(), nil)
}

// sdrLaunch starts rtl_tcp on this PC: rtl_tcp -a 127.0.0.1 -p PORT -d DEVICE.
func (s *Server) sdrLaunch(w http.ResponseWriter, r *http.Request) {
	body, err := readJSON(r, 2048)
	if err != nil {
		sendJSON(w, 415, errJSON("Expected JSON."), nil)
		return
	}
	portF, _ := body["port"].(float64)
	devF, _ := body["device"].(float64)
	port, dev := int(portF), int(devF)
	if float64(port) != portF || port < 1 || port > 65535 || float64(dev) != devF || dev < 0 || dev > 9 {
		sendJSON(w, 400, errJSON("Port must be 1-65535 and device 0-9."), nil)
		return
	}
	path, msg := findRtlTcp(asString(body["path"]))
	if path == "" {
		sendJSON(w, 404, errJSON(msg), nil)
		return
	}
	args := []string{"-a", "127.0.0.1", "-p", strconv.Itoa(port), "-d", strconv.Itoa(dev)}
	b := s.sdr
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.proc != nil {
		st := b.proc.status()
		if st["running"] == true && b.proc.path == path && strings.Join(b.proc.args, " ") == strings.Join(args, " ") {
			sendJSON(w, 200, st, nil)
			return
		}
		if st["running"] == true && b.proc.cmd.Process != nil {
			_ = b.proc.cmd.Process.Kill()
		}
	}
	cmd := hidden(exec.Command(path, args...))
	cmd.Dir = filepath.Dir(path)
	out, _ := cmd.StdoutPipe()
	cmd.Stderr = cmd.Stdout
	proc := &rtlProc{cmd: cmd, args: args, path: path}
	if err := cmd.Start(); err != nil {
		hint := ""
		if strings.Contains(strings.ToLower(err.Error()), "blocked") || strings.Contains(err.Error(), "4551") {
			hint = " Windows (Smart App Control) may have blocked it."
		}
		sendJSON(w, 502, errJSON("rtl_tcp couldn't start: "+err.Error()+"."+hint), nil)
		return
	}
	go func() {
		sc := bufio.NewScanner(out)
		for sc.Scan() {
			proc.add(sc.Text())
		}
	}()
	go func() {
		err := cmd.Wait()
		proc.mu.Lock()
		proc.exited = true
		if err != nil {
			proc.exitMsg = err.Error()
		} else {
			proc.exitMsg = "rtl_tcp stopped."
		}
		proc.mu.Unlock()
	}()
	b.proc = proc
	sendJSON(w, 200, proc.status(), nil)
}

func (s *Server) sdrLaunchStop(w http.ResponseWriter) {
	s.sdr.mu.Lock()
	p := s.sdr.proc
	s.sdr.mu.Unlock()
	if p != nil && p.cmd.Process != nil && p.status()["running"] == true {
		_ = p.cmd.Process.Kill()
	}
	sendJSON(w, 200, map[string]any{"running": false}, nil)
}

// StopRtlTcp stops an rtl_tcp that Band Watch started, when Band Watch quits.
func (s *Server) StopRtlTcp() {
	s.sdr.mu.Lock()
	p := s.sdr.proc
	s.sdr.mu.Unlock()
	if p != nil && p.cmd.Process != nil && p.status()["running"] == true {
		_ = p.cmd.Process.Kill()
	}
}
