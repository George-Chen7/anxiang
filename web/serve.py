"""Static-only server for the archived prototype (web/static.html).
Run with `python serve.py`. It has no /api/* routes, so the full system
in index.html will not work here; use web/start.bat -> server.py instead.
"""
import functools
import http.server
import os
import socketserver
import sys
import threading
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT_FIRST = 8765
PORT_LAST = 8775


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def open_browser(url):
    try:
        webbrowser.open(url)
    except Exception:
        print("Could not open a browser automatically. Please visit:")
        print("  " + url)


def main():
    handler = functools.partial(Handler, directory=ROOT)
    server = None
    for port in range(PORT_FIRST, PORT_LAST + 1):
        try:
            server = socketserver.ThreadingTCPServer(("127.0.0.1", port), handler)
            server.daemon_threads = True
            break
        except OSError:
            continue
    if server is None:
        print("ERROR: no free port between 8765 and 8775.")
        sys.exit(1)

    url = "http://127.0.0.1:%d/static.html" % server.server_address[1]
    print("Local server started: " + url)
    print("Folder: " + ROOT)
    print("Keep this window open. Close it or press Ctrl+C to stop the server.")
    if os.environ.get("ELDER_NO_BROWSER") != "1":
        threading.Timer(0.8, lambda: open_browser(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
