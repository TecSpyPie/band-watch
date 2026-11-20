// Band Watch + ClearRX: one installer for both programs.
// It carries the normal BandWatch-Setup.exe and the ClearRX zip inside it, runs the setup,
// puts ClearRX in <install folder>\ClearRX and makes the shortcuts for both.
// "/S" installs with no questions. A log is written to %TEMP%\BandWatch-ClearRX-Setup.log.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

static class BundleSetup
{
    const string Title = "Band Watch and ClearRX - Setup";
    const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\BandWatchM3vrv";
    const string StartupLinkName = "Band Watch by M3vrv.lnk";

    static string logPath;

    [STAThread]
    static int Main(string[] args)
    {
        logPath = Path.Combine(Path.GetTempPath(), "BandWatch-ClearRX-Setup.log");
        bool silent = false;
        foreach (string a in args)
        {
            if (a.Equals("/S", StringComparison.OrdinalIgnoreCase) || a.Equals("/silent", StringComparison.OrdinalIgnoreCase)) silent = true;
        }

        Application.EnableVisualStyles();
        string existing = ExistingInstall();
        string dest = existing ?? DefaultDest();
        bool startup = File.Exists(StartupLink());

        if (!silent)
        {
            dest = ChooseDest(dest, existing != null);
            if (dest == null) return 0;
            if (existing == null)
            {
                startup = MessageBox.Show("Start Band Watch automatically when Windows starts?", Title,
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) == DialogResult.Yes;
            }
        }

        string error = null;
        if (silent)
        {
            error = Install(dest, startup, null);
        }
        else
        {
            error = InstallWithWindow(dest, startup);
        }

        if (error != null)
        {
            Log("FAILED: " + error);
            if (!silent) MessageBox.Show("The installation did not finish:\n\n" + error, Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        Log("Finished.");
        if (!silent)
        {
            MessageBox.Show("Band Watch " + BundleVersion.BandWatch + " and ClearRX " + BundleVersion.ClearRX + " are installed in:\n" + dest +
                "\n\nBoth have an icon on your desktop and in the Start menu, and open in their own app windows.", Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
            try { Process.Start(Path.Combine(dest, "App", "BandWatchApp.exe")); } catch (Exception e) { Log("Opening Band Watch: " + e.Message); }
        }
        return 0;
    }

    // ---------- Questions ----------

    static string ChooseDest(string dest, bool update)
    {
        while (true)
        {
            string what = "Band Watch " + BundleVersion.BandWatch + " and ClearRX " + BundleVersion.ClearRX;
            string question = (update ? "Update to " + what + " in this folder?" : "Install " + what + " in this folder?") +
                "\n\n" + dest + "\n\nYes: install there\nNo: choose another drive or folder\nCancel: don't install";
            DialogResult answer = MessageBox.Show(question, Title, MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);
            if (answer == DialogResult.Yes) return dest;
            if (answer != DialogResult.No) return null;
            using (FolderBrowserDialog picker = new FolderBrowserDialog())
            {
                picker.Description = "Choose the drive or folder. A \"BandWatch\" folder is made inside it.";
                picker.ShowNewFolderButton = true;
                if (picker.ShowDialog() != DialogResult.OK) continue;
                string picked = picker.SelectedPath;
                if (!string.Equals(Path.GetFileName(picked.TrimEnd('\\')), "BandWatch", StringComparison.OrdinalIgnoreCase))
                {
                    picked = Path.Combine(picked, "BandWatch");
                }
                dest = picked;
            }
        }
    }

    static string InstallWithWindow(string dest, bool startup)
    {
        string error = null;
        using (Form form = new Form())
        {
            form.Text = Title;
            form.ClientSize = new Size(420, 96);
            form.FormBorderStyle = FormBorderStyle.FixedDialog;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.MaximizeBox = false;
            form.MinimizeBox = false;
            form.ControlBox = false;
            Label label = new Label();
            label.SetBounds(16, 16, 388, 24);
            label.Text = "Getting ready...";
            ProgressBar bar = new ProgressBar();
            bar.SetBounds(16, 50, 388, 22);
            bar.Style = ProgressBarStyle.Marquee;
            form.Controls.Add(label);
            form.Controls.Add(bar);
            form.Shown += delegate
            {
                Thread worker = new Thread(delegate()
                {
                    error = Install(dest, startup, delegate(string text)
                    {
                        form.BeginInvoke((MethodInvoker)delegate { label.Text = text; });
                    });
                    form.BeginInvoke((MethodInvoker)delegate { form.Close(); });
                });
                worker.IsBackground = true;
                worker.Start();
            };
            Application.Run(form);
        }
        return error;
    }

    // ---------- Installing ----------

    static string Install(string dest, bool startup, Action<string> status)
    {
        string temp = Path.Combine(Path.GetTempPath(), "bandwatch-bundle-" + Guid.NewGuid().ToString("N"));
        try
        {
            dest = dest.TrimEnd('\\');
            Log("Installing to " + dest + ", start with Windows: " + startup);
            Directory.CreateDirectory(temp);

            Say(status, "Installing the app windows...");
            string appDir = Path.Combine(dest, "App");
            StopAppWindows();
            ExtractZip("AppWindowsZip", appDir, "");

            Say(status, "Installing Band Watch " + BundleVersion.BandWatch + "...");
            string setup = Path.Combine(temp, "BandWatch-Setup.exe");
            SaveResource("BandWatchSetup", setup);
            // The setup opens Band Watch in Edge when it finishes. The empty shim program stops that.
            int code = Run(setup, "-S -dest \"" + dest + "\"", 180000, Path.Combine(appDir, "shim"));
            Log("BandWatch-Setup exit code " + code);
            if (code != 0) return "The Band Watch setup stopped with error " + code + ".";
            if (!File.Exists(Path.Combine(dest, "BandWatch.exe"))) return "BandWatch.exe was not found in " + dest + " after the setup.";
            try { Run(Path.Combine(dest, "BandWatch.exe"), "--stop", 10000); } catch (Exception e) { Log("BandWatch --stop: " + e.Message); }

            Say(status, "Installing ClearRX " + BundleVersion.ClearRX + "...");
            string clearRxDir = Path.Combine(dest, "ClearRX");
            StopClearRx(clearRxDir);
            ExtractZip("ClearRXZip", clearRxDir, "ClearRX\\");

            // The silent setup removes the "start with Windows" shortcut, so this puts back what the PC had.
            Say(status, "Making the shortcuts...");
            string script = Path.Combine(dest, "make-shortcuts.ps1");
            code = Run("powershell.exe", "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script +
                "\" -InstallDir \"" + dest + "\" -Startup " + (startup ? "yes" : "no"), 60000);
            Log("make-shortcuts exit code " + code);
            if (code != 0) return "Both programs are installed, but the shortcuts could not be made.";

            string retarget = Path.Combine(temp, "retarget-shortcuts.ps1");
            SaveResource("RetargetShortcuts", retarget);
            code = Run("powershell.exe", "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + retarget +
                "\" -InstallDir \"" + dest + "\"", 60000);
            Log("retarget-shortcuts exit code " + code);
            if (code != 0) return "Both programs are installed, but the icons could not be switched to the app windows.";

            PatchUninstall(dest);
            RegisterUninstall(dest);
            return null;
        }
        catch (Exception e)
        {
            return e.Message;
        }
        finally
        {
            try { Directory.Delete(temp, true); } catch (Exception) { }
        }
    }

    static void StopAppWindows()
    {
        foreach (string name in new[] { "BandWatchApp", "ClearRXApp" })
        {
            foreach (Process p in Process.GetProcessesByName(name))
            {
                try
                {
                    p.CloseMainWindow();
                    if (!p.WaitForExit(5000)) { p.Kill(); p.WaitForExit(5000); }
                }
                catch (Exception e) { Log("Stopping " + name + ": " + e.Message); }
            }
        }
    }

    // Closes the app windows too when Band Watch is uninstalled, so its folder can be removed.
    static void PatchUninstall(string dest)
    {
        string path = Path.Combine(dest, "uninstall.bat");
        if (!File.Exists(path)) return;
        string text = File.ReadAllText(path);
        if (text.Contains("BandWatchApp.exe")) return;
        const string stopLine = "call \"%~dp0stop-bandwatch.bat\" quiet";
        text = text.Replace(stopLine, "taskkill /im BandWatchApp.exe /f >nul 2>nul\r\ntaskkill /im ClearRXApp.exe /f >nul 2>nul\r\n" + stopLine);
        File.WriteAllText(path, text, new System.Text.UTF8Encoding(false));
    }

    static void RegisterUninstall(string dest)
    {
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(UninstallKey))
        {
            key.SetValue("DisplayName", "Band Watch by M3vrv");
            key.SetValue("DisplayVersion", BundleVersion.BandWatch);
            key.SetValue("Publisher", "M3vrv");
            key.SetValue("DisplayIcon", Path.Combine(dest, "bandwatch.ico"));
            key.SetValue("InstallLocation", dest);
            key.SetValue("UninstallString", "\"" + Path.Combine(dest, "uninstall.bat") + "\"");
            key.SetValue("NoModify", 1, RegistryValueKind.DWord);
            key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        }
    }

    static void ExtractZip(string resource, string folder, string stripPrefix)
    {
        Directory.CreateDirectory(folder);
        string root = Path.GetFullPath(folder).TrimEnd('\\') + "\\";
        using (Stream zipStream = Resource(resource))
        using (ZipArchive zip = new ZipArchive(zipStream, ZipArchiveMode.Read))
        {
            foreach (ZipArchiveEntry entry in zip.Entries)
            {
                if (entry.Name.Length == 0) continue;
                string relative = entry.FullName.Replace('/', '\\');
                if (stripPrefix.Length > 0 && relative.StartsWith(stripPrefix, StringComparison.OrdinalIgnoreCase)) relative = relative.Substring(stripPrefix.Length);
                string target = Path.GetFullPath(Path.Combine(folder, relative));
                if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new IOException("Bad path in " + resource + ": " + entry.FullName);
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                WriteWithRetry(entry, target);
                Log("Wrote " + target);
            }
        }
    }

    // ClearRX may take a moment to let go of its files after it is stopped.
    static void WriteWithRetry(ZipArchiveEntry entry, string target)
    {
        for (int attempt = 1; ; attempt++)
        {
            try
            {
                using (Stream input = entry.Open())
                using (FileStream output = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None))
                {
                    input.CopyTo(output);
                }
                return;
            }
            catch (IOException)
            {
                if (attempt >= 20) throw;
                Thread.Sleep(250);
            }
            catch (UnauthorizedAccessException)
            {
                if (attempt >= 20) throw;
                Thread.Sleep(250);
            }
        }
    }

    static void StopClearRx(string clearRxDir)
    {
        string exe = Path.Combine(clearRxDir, "ClearRX.exe");
        if (!File.Exists(exe)) return;
        try { Run(exe, "--stop", 8000); } catch (Exception e) { Log("ClearRX --stop: " + e.Message); }
        foreach (Process p in Process.GetProcessesByName("ClearRX"))
        {
            try
            {
                if (string.Equals(p.MainModule.FileName, exe, StringComparison.OrdinalIgnoreCase))
                {
                    p.Kill();
                    p.WaitForExit(5000);
                }
            }
            catch (Exception e) { Log("Stopping ClearRX: " + e.Message); }
        }
    }

    // ---------- Helpers ----------

    static int Run(string file, string arguments, int timeoutMs)
    {
        return Run(file, arguments, timeoutMs, null);
    }

    static int Run(string file, string arguments, int timeoutMs, string shim)
    {
        ProcessStartInfo info = new ProcessStartInfo(file, arguments);
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        if (shim != null)
        {
            info.EnvironmentVariables["ProgramFiles(x86)"] = shim;
            info.EnvironmentVariables["ProgramFiles"] = shim;
            info.EnvironmentVariables["LOCALAPPDATA"] = shim;
        }
        using (Process p = Process.Start(info))
        {
            if (!p.WaitForExit(timeoutMs))
            {
                try { p.Kill(); } catch (Exception) { }
                throw new TimeoutException(Path.GetFileName(file) + " took too long.");
            }
            return p.ExitCode;
        }
    }

    static Stream Resource(string name)
    {
        Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream(name);
        if (s == null) throw new IOException("This installer is damaged (" + name + " is missing). Build or download it again.");
        return s;
    }

    static void SaveResource(string name, string path)
    {
        using (Stream input = Resource(name))
        using (FileStream output = File.Create(path))
        {
            input.CopyTo(output);
        }
    }

    static string ExistingInstall()
    {
        using (RegistryKey key = Registry.CurrentUser.OpenSubKey(UninstallKey))
        {
            string path = key == null ? null : key.GetValue("InstallLocation") as string;
            if (!string.IsNullOrEmpty(path) && File.Exists(Path.Combine(path, "BandWatch.exe"))) return path;
        }
        return null;
    }

    static string DefaultDest()
    {
        string drive = Environment.GetEnvironmentVariable("SystemDrive");
        if (string.IsNullOrEmpty(drive)) drive = "C:";
        return drive + "\\BandWatch";
    }

    static string StartupLink()
    {
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), StartupLinkName);
    }

    static void Say(Action<string> status, string text)
    {
        Log(text);
        if (status != null) status(text);
    }

    static void Log(string text)
    {
        try { File.AppendAllText(logPath, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + text + Environment.NewLine); }
        catch (Exception) { }
    }
}
