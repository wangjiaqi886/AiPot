using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Automation;

// AiPot selection helper.
//
// Reads the current text selection with the smallest possible latency:
//   1. capture the current foreground window;
//   2. send Ctrl+C with keybd_event (no PowerShell/.NET Forms startup);
//   3. watch the clipboard sequence number and read CF_UNICODETEXT;
//   4. fall back to UI Automation TextPattern if the app ignores Ctrl+C.
//
// Exit codes: 0 = text on stdout, 2 = empty selection, 3 = failure.
internal static class Program
{
    private const int VK_CONTROL = 0x11;
    private const int VK_C = 0x43;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint CF_UNICODETEXT = 13;
    private const uint GMEM_MOVEABLE = 0x0002;
    private const int ClipboardOpenAttempts = 12;

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    private static extern uint GetClipboardSequenceNumber();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool OpenClipboard(IntPtr hWndNewOwner);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseClipboard();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EmptyClipboard();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetClipboardData(uint uFormat);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetClipboardData(uint uFormat, IntPtr hMem);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool IsClipboardFormatAvailable(uint format);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalLock(IntPtr hMem);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GlobalUnlock(IntPtr hMem);

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            var target = GetForegroundWindow();
            var uiaOnly = args.Length > 0 && args[0] == "--uia";

            if (!uiaOnly)
            {
                var clipboardText = TryClipboardCopy(target);
                if (!string.IsNullOrWhiteSpace(clipboardText))
                {
                    Write(clipboardText);
                    return 0;
                }
            }

            var uiaText = TryUia(target, 700);
            if (!string.IsNullOrWhiteSpace(uiaText))
            {
                Write(uiaText);
                return 0;
            }

            return 2;
        }
        catch
        {
            return 3;
        }
    }

    private static string TryClipboardCopy(IntPtr target)
    {
        var originalText = ReadClipboardText();
        var sequence = GetClipboardSequenceNumber();

        FocusWindow(target);
        Thread.Sleep(25);
        SendCtrlC();

        var deadline = Environment.TickCount + 650;
        while (Environment.TickCount < deadline)
        {
            if (GetClipboardSequenceNumber() != sequence)
            {
                var text = ReadClipboardText();
                if (!string.IsNullOrWhiteSpace(text))
                {
                    RestoreText(originalText);
                    return text;
                }
            }

            Thread.Sleep(20);
        }

        return null;
    }

    private static void FocusWindow(IntPtr target)
    {
        if (target == IntPtr.Zero)
        {
            return;
        }

        uint targetProcessId;
        var targetThread = GetWindowThreadProcessId(target, out targetProcessId);
        var currentThread = GetCurrentThreadId();
        var attached = false;
        if (targetThread != 0 && targetThread != currentThread)
        {
            attached = AttachThreadInput(currentThread, targetThread, true);
        }

        SetForegroundWindow(target);
        if (attached)
        {
            AttachThreadInput(currentThread, targetThread, false);
        }
    }

    private static void SendCtrlC()
    {
        keybd_event((byte)VK_CONTROL, 0, 0, UIntPtr.Zero);
        keybd_event((byte)VK_C, 0, 0, UIntPtr.Zero);
        Thread.Sleep(20);
        keybd_event((byte)VK_C, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
        keybd_event((byte)VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    }

    private static string TryUia(IntPtr target, int timeoutMs)
    {
        string result = null;
        var thread = new Thread(() =>
        {
            try
            {
                result = GetUiaText(target);
            }
            catch
            {
                result = null;
            }
        });
        thread.IsBackground = true;
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        if (!thread.Join(timeoutMs))
        {
            return null;
        }

        return result;
    }

    private static string GetUiaText(IntPtr target)
    {
        var element = AutomationElement.FocusedElement;
        for (var i = 0; i < 8 && element != null; i += 1)
        {
            var text = GetTextPatternSelection(element);
            if (!string.IsNullOrWhiteSpace(text))
            {
                return text;
            }

            element = TreeWalker.ControlViewWalker.GetParent(element);
        }

        if (target == IntPtr.Zero)
        {
            return null;
        }

        var root = AutomationElement.FromHandle(target);
        if (root == null)
        {
            return null;
        }

        var condition = new PropertyCondition(
            AutomationElement.IsTextPatternAvailableProperty,
            true
        );
        var elements = root.FindAll(TreeScope.Subtree, condition);
        var inspected = 0;
        foreach (AutomationElement candidate in elements)
        {
            inspected += 1;
            if (inspected > 48)
            {
                break;
            }

            var text = GetTextPatternSelection(candidate);
            if (!string.IsNullOrWhiteSpace(text))
            {
                return text;
            }
        }

        return null;
    }

    private static string GetTextPatternSelection(AutomationElement element)
    {
        if (element == null)
        {
            return null;
        }

        object patternObject;
        if (!element.TryGetCurrentPattern(TextPattern.Pattern, out patternObject))
        {
            return null;
        }

        try
        {
            var pattern = (TextPattern)patternObject;
            var ranges = pattern.GetSelection();
            if (ranges == null || ranges.Length == 0)
            {
                return null;
            }

            var parts = new List<string>();
            foreach (var range in ranges)
            {
                string text;
                try
                {
                    text = range.GetText(-1);
                }
                catch
                {
                    text = null;
                }

                if (!string.IsNullOrWhiteSpace(text))
                {
                    parts.Add(text.Trim());
                }
            }

            return parts.Count == 0 ? null : string.Join("\n", parts.ToArray());
        }
        catch
        {
            return null;
        }
    }

    private static string ReadClipboardText()
    {
        for (var attempt = 0; attempt < ClipboardOpenAttempts; attempt += 1)
        {
            if (!IsClipboardFormatAvailable(CF_UNICODETEXT))
            {
                return null;
            }

            if (!OpenClipboard(IntPtr.Zero))
            {
                Thread.Sleep(15);
                continue;
            }

            try
            {
                var handle = GetClipboardData(CF_UNICODETEXT);
                if (handle == IntPtr.Zero)
                {
                    return null;
                }

                var pointer = GlobalLock(handle);
                if (pointer == IntPtr.Zero)
                {
                    return null;
                }

                try
                {
                    return Marshal.PtrToStringUni(pointer);
                }
                finally
                {
                    GlobalUnlock(handle);
                }
            }
            finally
            {
                CloseClipboard();
            }
        }

        return null;
    }

    private static void RestoreText(string originalText)
    {
        if (string.IsNullOrEmpty(originalText))
        {
            return;
        }

        for (var attempt = 0; attempt < ClipboardOpenAttempts; attempt += 1)
        {
            if (!OpenClipboard(IntPtr.Zero))
            {
                Thread.Sleep(15);
                continue;
            }

            try
            {
                EmptyClipboard();
                var bytes = (originalText.Length + 1) * 2;
                var handle = GlobalAlloc(GMEM_MOVEABLE, (UIntPtr)bytes);
                if (handle == IntPtr.Zero)
                {
                    return;
                }

                var pointer = GlobalLock(handle);
                if (pointer == IntPtr.Zero)
                {
                    return;
                }

                try
                {
                    var chars = originalText.ToCharArray();
                    Marshal.Copy(chars, 0, pointer, chars.Length);
                    Marshal.WriteInt16(pointer, chars.Length * 2, 0);
                }
                finally
                {
                    GlobalUnlock(handle);
                }

                SetClipboardData(CF_UNICODETEXT, handle);
                return;
            }
            finally
            {
                CloseClipboard();
            }
        }
    }

    private static void Write(string text)
    {
        var bytes = Encoding.UTF8.GetBytes(text);
        using (var stdout = Console.OpenStandardOutput())
        {
            stdout.Write(bytes, 0, bytes.Length);
            stdout.Flush();
        }
    }
}