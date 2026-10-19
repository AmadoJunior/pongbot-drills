"""Pongbot account login with a cached session token, shared by the tools.

The token is saved in your user profile (~/.pongbot/token.json), outside any
repository, and reused until the server rejects it. Then you are asked to log
in again. The password is never stored.

Run `python pongbot_auth.py --logout` to delete the cached token.
"""
import getpass
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://intel.futuremind.com.cn/app"
TOKEN_FILE = Path.home() / ".pongbot" / "token.json"


def request(method, path, token=None, body=None):
    """One API call. Returns (http_status, parsed_json_or_{'raw': text}, text)."""
    url = BASE + path
    headers = {"Content-Type": "application/json; charset=UTF-8", "Accept-Language": "en", "appOs": "android"}
    if token:
        headers["Authorization"] = token
    data = None
    if method == "GET" and body:
        url += "?" + urllib.parse.urlencode(body)
    elif body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status, text = r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        status, text = e.code, e.read().decode("utf-8", "replace")
    try:
        return status, json.loads(text), text
    except json.JSONDecodeError:
        return status, {"raw": text}, text


def is_expired(status, resp):
    # The official app (DioHttpService) treats HTTP 400 or code 400 as "login
    # expired, please login again" and sends the user to the login screen.
    code = resp.get("code") if isinstance(resp, dict) else None
    return status in (400, 401) or code in (400, 401, "400", "401")


def _load():
    try:
        return json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _save(account, token):
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(json.dumps({"account": account, "token": token, "savedAt": int(time.time())}), encoding="utf-8")
    try:
        os.chmod(TOKEN_FILE, 0o600)  # owner only where the OS supports it
    except OSError:
        pass


def logout():
    TOKEN_FILE.unlink(missing_ok=True)


class Session:
    """API session that logs in only when there is no valid cached token."""

    def __init__(self):
        cached = _load()
        self.account = cached.get("account")
        self.token = cached.get("token")
        if self.token:
            print(f"Using saved login for {self.account} (delete with: python app/tools/pongbot_auth.py --logout).")
        else:
            self.login()

    def login(self):
        hint = f" [{self.account}]" if self.account else ""
        account = input(f"Pongbot account (email){hint}: ").strip() or self.account
        password = getpass.getpass("Password: ")
        _, resp, _ = request("POST", "/auth/login/userlogin", body={"account": account, "password": password})
        data = resp.get("data") if isinstance(resp, dict) else None
        token = data.get("token") if isinstance(data, dict) else data if isinstance(data, str) else None
        if not token:
            sys.exit(f"Login failed: {resp.get('message') if isinstance(resp, dict) else resp}")
        self.account, self.token = account, token
        _save(account, token)
        print("Logged in; login saved for next time.")

    def call(self, method, path, body=None):
        """Authenticated call; logs in again once if the saved token has expired."""
        status, resp, text = request(method, path, self.token, body)
        if is_expired(status, resp):
            print("Saved login expired, please log in again.")
            self.login()
            status, resp, text = request(method, path, self.token, body)
        return resp, text


if __name__ == "__main__":
    if "--logout" in sys.argv:
        logout()
        print(f"Deleted {TOKEN_FILE}")
    else:
        print(f"Token file: {TOKEN_FILE} ({'present' if TOKEN_FILE.exists() else 'none'})")
