// A real Windows app window for Band Watch or ClearRX (TEST VERSION).
// It starts the installed program's local server without a browser and shows its page in a window of
// its own, using Microsoft WebView2. Build with /define:CLEARRX for ClearRX, otherwise it is Band Watch.
// "--selftest <file>" checks the features the apps depend on, writes the results and closes.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

static class Config
{
#if CLEARRX
    public const string Name = "ClearRX by M3VRV";
    public const string Url = "http://localhost:8074/";
    public const string Health = "http://127.0.0.1:8074/healthz";
    const string ServerRelative = @"ClearRX\ClearRX.exe";
    public const string ServerArgs = "";
    public const string Folder = "ClearRXApp";
    public const string AppId = "M3VRV.ClearRX.App";
    public const int Width = 980, Height = 820;
    public const bool NeedsShim = true;
#else
    public const string Name = "Band Watch by M3vrv";
    public const string Url = "http://localhost:8073/";
    public const string Health = "http://127.0.0.1:8073/healthz";
    const string ServerRelative = "BandWatch.exe";
    public const string ServerArgs = "--background";
    public const string Folder = "BandWatchApp";
    public const string AppId = "M3VRV.BandWatch.App";
    public const int Width = 1280, Height = 860;
    public const bool NeedsShim = false;
#endif

    // The app lives in <install folder>\App, so the program it starts is one folder up.
    public static readonly string ServerExe = FindServer();

    static string FindServer()
    {
        string install = Path.GetDirectoryName(Path.GetDirectoryName(Application.ExecutablePath));
        string beside = Path.Combine(install, ServerRelative);
        return File.Exists(beside) ? beside : Path.Combine(@"C:\BandWatch", ServerRelative);
    }
}

static class Program
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SetCurrentProcessExplicitAppUserModelID(string id);
    [DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hWnd, int cmd);

    // A diagnostic script to run against the app's real saved settings, instead of the built-in self-test.
    public static string ScriptFile;

    [STAThread]
    static int Main(string[] args)
    {
        string selftest = null;
        for (int i = 0; i + 1 < args.Length; i++)
        {
            if (args[i] == "--selftest") selftest = args[i + 1];
            if (args[i] == "--script") ScriptFile = args[i + 1];
        }

        SetCurrentProcessExplicitAppUserModelID(Config.AppId);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        bool first;
        using (Mutex mutex = new Mutex(true, "Local\\" + Config.AppId + (selftest != null ? ".selftest" : ""), out first))
        {
            if (!first)
            {
                Process me = Process.GetCurrentProcess();
                foreach (Process p in Process.GetProcessesByName(me.ProcessName))
                {
                    if (p.Id != me.Id && p.MainWindowHandle != IntPtr.Zero)
                    {
                        ShowWindow(p.MainWindowHandle, 9);
                        SetForegroundWindow(p.MainWindowHandle);
                    }
                }
                return 0;
            }
            HostForm form = new HostForm(selftest);
            Application.Run(form);
            return form.ExitCode;
        }
    }
}

class HostForm : Form
{
    readonly WebView2 web = new WebView2();
    readonly string selftestFile;
    CoreWebView2Environment env;
    bool startedServer;
    bool selftestRan;
    public int ExitCode;

    public HostForm(string selftest)
    {
        selftestFile = selftest;
        Text = Config.Name;
        BackColor = Color.FromArgb(11, 26, 38);
        StartPosition = FormStartPosition.CenterScreen;
        Rectangle area = Screen.PrimaryScreen.WorkingArea;
        ClientSize = new Size(Math.Min(Config.Width, area.Width - 40), Math.Min(Config.Height, area.Height - 60));
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = BackColor;
        Controls.Add(web);
        Load += OnLoadAsync;
        FormClosing += OnClosing;
    }

    async void OnLoadAsync(object sender, EventArgs e)
    {
        try
        {
            await Task.Run(() => EnsureServer());
            string folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "M3vrv", Config.Folder + (selftestFile != null && Program.ScriptFile == null ? "-selftest" : ""), "WebView2");
            CoreWebView2EnvironmentOptions options = new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required");
            env = await CoreWebView2Environment.CreateAsync(null, folder, options);
            await web.EnsureCoreWebView2Async(env);
            Hook(web.CoreWebView2, this);
            web.CoreWebView2.DocumentTitleChanged += delegate
            {
                if (web.CoreWebView2.DocumentTitle.Length > 0) Text = web.CoreWebView2.DocumentTitle;
            };
            if (selftestFile != null) StartSelfTest();
            web.CoreWebView2.Navigate(Config.Url);
#if !CLEARRX
            if (selftestFile == null) StartUpdateWatch();
#endif
        }
        catch (Exception ex)
        {
            Fail(ex.Message);
        }
    }

    void Fail(string message)
    {
        ExitCode = 1;
        if (selftestFile != null) { File.WriteAllText(selftestFile, "{\"fatal\":" + Quote(message) + "}"); Close(); return; }
        MessageBox.Show(Config.Name + " couldn't start:\n\n" + message, Config.Name, MessageBoxButtons.OK, MessageBoxIcon.Error);
        Close();
    }

    // ---------- The page's behaviour inside the window ----------

    void Hook(CoreWebView2 core, Form owner)
    {
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;

        core.PermissionRequested += delegate(object s, CoreWebView2PermissionRequestedEventArgs e)
        {
            e.State = IsLocal(e.Uri) ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
        };
        core.NavigationStarting += delegate(object s, CoreWebView2NavigationStartingEventArgs e)
        {
            if (IsWeb(e.Uri) && !IsLocal(e.Uri)) { e.Cancel = true; OpenInBrowser(e.Uri); }
        };
        core.WindowCloseRequested += delegate { owner.Close(); };
        core.NewWindowRequested += OnNewWindow;
    }

    async void OnNewWindow(object sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        if (IsWeb(e.Uri) && !IsLocal(e.Uri))
        {
            e.Handled = true;
            OpenInBrowser(e.Uri);
            return;
        }
        CoreWebView2Deferral deferral = e.GetDeferral();
        try
        {
            Form popup = new Form();
            popup.Text = Config.Name;
            popup.Icon = Icon;
            popup.BackColor = BackColor;
            popup.StartPosition = FormStartPosition.CenterParent;
            popup.ClientSize = e.WindowFeatures.HasSize
                ? new Size((int)e.WindowFeatures.Width, (int)e.WindowFeatures.Height)
                : new Size(900, 700);
            WebView2 view = new WebView2();
            view.Dock = DockStyle.Fill;
            view.DefaultBackgroundColor = BackColor;
            popup.Controls.Add(view);
            popup.Show(this);
            await view.EnsureCoreWebView2Async(env);
            Hook(view.CoreWebView2, popup);
            view.CoreWebView2.DocumentTitleChanged += delegate
            {
                if (view.CoreWebView2.DocumentTitle.Length > 0) popup.Text = view.CoreWebView2.DocumentTitle;
            };
            e.NewWindow = view.CoreWebView2;
            e.Handled = true;
        }
        finally
        {
            deferral.Complete();
        }
    }

    static bool IsWeb(string uri)
    {
        return uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase);
    }

    static bool IsLocal(string uri)
    {
        Uri parsed;
        if (!Uri.TryCreate(uri, UriKind.Absolute, out parsed)) return false;
        return parsed.Host == "localhost" || parsed.Host == "127.0.0.1";
    }

    static void OpenInBrowser(string uri)
    {
        try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); } catch (Exception) { }
    }

    // ---------- The program's local server ----------

    void EnsureServer()
    {
        if (Healthy()) return;
        if (!File.Exists(Config.ServerExe)) throw new FileNotFoundException(Config.ServerExe + " was not found. Install Band Watch and ClearRX first.");
        ProcessStartInfo info = new ProcessStartInfo(Config.ServerExe, Config.ServerArgs);
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.WorkingDirectory = Path.GetDirectoryName(Config.ServerExe);
        if (Config.NeedsShim)
        {
            // ClearRX always asks for an Edge window when it starts. This points it at a small empty
            // program, so that only this app's window opens.
            string shim = Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), "shim");
            info.EnvironmentVariables["ProgramFiles(x86)"] = shim;
            info.EnvironmentVariables["ProgramFiles"] = shim;
            info.EnvironmentVariables["LOCALAPPDATA"] = shim;
        }
        Process.Start(info);
        startedServer = true;
        for (int i = 0; i < 60; i++)
        {
            if (Healthy()) return;
            Thread.Sleep(250);
        }
        throw new TimeoutException(Path.GetFileName(Config.ServerExe) + " did not start.");
    }

    static bool Healthy()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Config.Health);
            request.Proxy = null;
            request.Timeout = 1500;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            {
                return response.StatusCode == HttpStatusCode.OK;
            }
        }
        catch (Exception) { return false; }
    }

    void OnClosing(object sender, FormClosingEventArgs e)
    {
        if (!startedServer) return;
        startedServer = false;
        Hide();
        try
        {
            ProcessStartInfo info = new ProcessStartInfo(Config.ServerExe, "--stop");
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            using (Process p = Process.Start(info)) { p.WaitForExit(6000); }
        }
        catch (Exception) { }
    }

#if !CLEARRX
    // ---------- Updates from inside Band Watch ----------
    // "Install update" runs the normal Band Watch setup, which points the icons back at the Edge version,
    // removes the start-with-Windows shortcut and opens an Edge window. When Band Watch's server restarts,
    // this window puts all of that back the way it was.

    string lastStarted;
    bool checking;
    int edgeSweeps;

    void StartUpdateWatch()
    {
        Task.Run(() => Upkeep.Repair(false));
        System.Windows.Forms.Timer watch = new System.Windows.Forms.Timer();
        watch.Interval = 4000;
        watch.Tick += OnWatchTick;
        watch.Start();
    }

    async void OnWatchTick(object sender, EventArgs e)
    {
        if (edgeSweeps > 0)
        {
            edgeSweeps--;
            Upkeep.CloseEdgeCopies();
        }
        if (checking) return;
        checking = true;
        string started = await Task.Run(() => ServerStarted());
        checking = false;
        if (started == null) return;
        if (lastStarted != null && started != lastStarted)
        {
            Upkeep.Log("Band Watch restarted (" + lastStarted + " -> " + started + "), tidying up after it.");
            await Task.Run(() => Upkeep.Repair(true));
            edgeSweeps = 30; // about two minutes
            Upkeep.CloseEdgeCopies();
            if (web.CoreWebView2 != null) web.CoreWebView2.Reload();
        }
        lastStarted = started;
    }

    // When Band Watch's server started, from its health check, or null if it isn't answering.
    static string ServerStarted()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create(Config.Health);
            request.Proxy = null;
            request.Timeout = 2500;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream()))
            {
                Match m = Regex.Match(reader.ReadToEnd(), "\"started\":\"([^\"]+)\"");
                return m.Success ? m.Groups[1].Value : null;
            }
        }
        catch (Exception) { return null; }
    }
#endif

    // ---------- Self-test ----------

    void StartSelfTest()
    {
        System.Windows.Forms.Timer limit = new System.Windows.Forms.Timer();
        limit.Interval = 45000;
        limit.Tick += delegate { limit.Stop(); Fail("The self-test timed out."); };
        limit.Start();

        web.CoreWebView2.NavigationCompleted += async delegate
        {
            if (selftestRan) return;
            selftestRan = true;
            await Task.Delay(3000);
            string script;
            if (Program.ScriptFile != null)
            {
                script = File.ReadAllText(Program.ScriptFile, Encoding.UTF8);
            }
            else
            {
                using (StreamReader reader = new StreamReader(Assembly.GetExecutingAssembly().GetManifestResourceStream("selftest"), Encoding.UTF8))
                {
                    script = reader.ReadToEnd();
                }
            }
            await web.CoreWebView2.ExecuteScriptAsync(script);
        };

        web.CoreWebView2.WebMessageReceived += async delegate(object s, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string message = e.TryGetWebMessageAsString();
            if (message == "click")
            {
                // A real mouse click, because Windows' port picker only opens after one.
                await web.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", "{\"type\":\"mousePressed\",\"x\":20,\"y\":20,\"button\":\"left\",\"clickCount\":1}");
                await web.CoreWebView2.CallDevToolsProtocolMethodAsync("Input.dispatchMouseEvent", "{\"type\":\"mouseReleased\",\"x\":20,\"y\":20,\"button\":\"left\",\"clickCount\":1}");
                return;
            }
            limit.Stop();
            File.WriteAllText(selftestFile, message);
            using (FileStream png = File.Create(Path.ChangeExtension(selftestFile, ".png")))
            {
                await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, png);
            }
            Close();
        };
    }

    static string Quote(string text)
    {
        return "\"" + text.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ") + "\"";
    }
}

#if !CLEARRX
// Keeps the icons, the start-with-Windows shortcut and the uninstaller pointing at the app windows.
static class Upkeep
{
    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
    const uint WM_CLOSE = 0x0010;

    static readonly object gate = new object();
    static string Install { get { return Path.GetDirectoryName(Config.ServerExe); } }
    static string AppDir { get { return Path.GetDirectoryName(Application.ExecutablePath); } }
    static string DataDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "M3vrv", "BandWatchApp"); } }
    static string StartupLink { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "Band Watch by M3vrv.lnk"); } }

    public static void Log(string text)
    {
        try
        {
            Directory.CreateDirectory(DataDir);
            File.AppendAllText(Path.Combine(DataDir, "upkeep.log"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + text + Environment.NewLine);
        }
        catch (Exception) { }
    }

    // afterUpdate: the setup has just run, so put back the start-with-Windows shortcut if the PC had it.
    public static void Repair(bool afterUpdate)
    {
        lock (gate)
        {
            try
            {
                dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell"));
                string bandWatch = Path.Combine(AppDir, "BandWatchApp.exe");
                string clearRx = Path.Combine(AppDir, "ClearRXApp.exe");
                bool haveClearRx = File.Exists(clearRx) && File.Exists(Path.Combine(Install, @"ClearRX\ClearRX.exe"));
                string[] folders = {
                    Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Band Watch by M3vrv")
                };
                foreach (string folder in folders)
                {
                    Point(shell, Path.Combine(folder, "Band Watch by M3vrv.lnk"), bandWatch, Path.Combine(Install, "bandwatch.ico"), "Open Band Watch by M3vrv");
                    if (haveClearRx)
                    {
                        Point(shell, Path.Combine(folder, "ClearRX by M3VRV.lnk"), clearRx, Path.Combine(Install, @"ClearRX\clearrx.ico"), "Open ClearRX by M3VRV, the radio audio processor");
                    }
                }

                Directory.CreateDirectory(DataDir);
                string pref = Path.Combine(DataDir, "start-with-windows.txt");
                if (!afterUpdate)
                {
                    File.WriteAllText(pref, File.Exists(StartupLink) ? "yes" : "no");
                }
                else if (File.Exists(pref) && File.ReadAllText(pref).Trim() == "yes" && !File.Exists(StartupLink))
                {
                    dynamic link = shell.CreateShortcut(StartupLink);
                    link.TargetPath = Path.Combine(Install, "start-bandwatch.bat");
                    link.Arguments = "--background";
                    link.WorkingDirectory = Install;
                    link.IconLocation = Path.Combine(Install, "bandwatch.ico") + ",0";
                    link.WindowStyle = 7;
                    link.Description = "Start Band Watch by M3vrv in the background";
                    link.Save();
                    Log("Put back the start-with-Windows shortcut.");
                }

                PatchUninstall();
            }
            catch (Exception e)
            {
                Log("Repair failed: " + e.Message);
            }
        }
    }

    // Only fixes shortcuts that exist, so one you deleted on purpose stays deleted.
    static void Point(dynamic shell, string path, string target, string icon, string description)
    {
        if (!File.Exists(path)) return;
        dynamic link = shell.CreateShortcut(path);
        if (string.Equals((string)link.TargetPath, target, StringComparison.OrdinalIgnoreCase)) return;
        link.TargetPath = target;
        link.Arguments = "";
        link.WorkingDirectory = Path.GetDirectoryName(target);
        link.IconLocation = icon + ",0";
        link.WindowStyle = 1;
        link.Description = description;
        link.Save();
        Log("Pointed " + path + " at " + target);
    }

    // So uninstalling also closes the app windows and can remove their folder.
    static void PatchUninstall()
    {
        string path = Path.Combine(Install, "uninstall.bat");
        if (!File.Exists(path)) return;
        string text = File.ReadAllText(path);
        if (text.Contains("BandWatchApp.exe")) return;
        const string stopLine = "call \"%~dp0stop-bandwatch.bat\" quiet";
        if (!text.Contains(stopLine)) return;
        text = text.Replace(stopLine, "taskkill /im BandWatchApp.exe /f >nul 2>nul\r\ntaskkill /im ClearRXApp.exe /f >nul 2>nul\r\n" + stopLine);
        File.WriteAllText(path, text, new UTF8Encoding(false));
        Log("Updated uninstall.bat to close the app windows.");
    }

    // Closes the Edge app window the setup opens (its title is exactly Band Watch's), not ordinary Edge windows.
    public static void CloseEdgeCopies()
    {
        List<IntPtr> found = new List<IntPtr>();
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
        {
            if (!IsWindowVisible(hWnd)) return true;
            StringBuilder title = new StringBuilder(256);
            GetWindowText(hWnd, title, title.Capacity);
            if (title.ToString() != Config.Name) return true;
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            try
            {
                using (Process p = Process.GetProcessById((int)pid))
                {
                    if (string.Equals(p.ProcessName, "msedge", StringComparison.OrdinalIgnoreCase)) found.Add(hWnd);
                }
            }
            catch (Exception) { }
            return true;
        }, IntPtr.Zero);
        foreach (IntPtr hWnd in found)
        {
            PostMessage(hWnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
            Log("Closed the Edge copy of Band Watch that the setup opened.");
        }
    }
}
#endif
