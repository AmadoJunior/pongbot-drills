"""Export your custom drills from the official PONGBOT PingPong app's cloud account.

Usage:  python import_official.py [output.json]

Logs in with your Pongbot account (the password is typed at a prompt and not
stored), downloads your custom drill groups and writes them to a JSON file.
Import that file in Nova+ (··· -> Import drills).

The endpoints and field names come from reverse engineering the official app
(see re/FINDINGS.md). Request details were not verified against the live
server, so the script saves every raw response under ./official_raw/ to help
adjust it if something doesn't match.
"""
import getpass
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BASE = "https://intel.futuremind.com.cn/app"
# Product series code -> robot (from queryProductSeriesByUser).
SERIES_MODEL = {"O38": "nova", "O58": "halo"}
RAW = Path("official_raw")


def call(method, path, token=None, body=None, tag="", sub=""):
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
        with urllib.request.urlopen(req, timeout=20) as r:
            text = r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
    name = path.strip("/").replace("/", "_") + f"_{method}{tag}.json"
    (RAW / sub / name).write_text(text, encoding="utf-8")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {"raw": text}


def rows_of(resp):
    data = resp.get("data") if isinstance(resp, dict) else None
    if isinstance(data, dict):
        return data.get("rows") or data.get("list") or data.get("records") or []
    return data if isinstance(data, list) else resp.get("rows", []) if isinstance(resp, dict) else []


def collect_series(resp, out):
    """Collect every value of a key named like productSeries* from a response."""
    if isinstance(resp, dict):
        for k, v in resp.items():
            if k.lower().startswith("productseries") and isinstance(v, (str, int)) and v not in out:
                out.append(v)
            else:
                collect_series(v, out)
    elif isinstance(resp, list):
        for v in resp:
            collect_series(v, out)


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "official_drills.json")
    RAW.mkdir(exist_ok=True)
    account = input("Pongbot account (email): ").strip()
    password = getpass.getpass("Password: ")

    login = call("POST", "/auth/login/userlogin", body={"account": account, "password": password})
    data = login.get("data") if isinstance(login, dict) else None
    token = data.get("token") if isinstance(data, dict) else data if isinstance(data, str) else None
    if not token:
        sys.exit(f"Login failed: {login.get('message') or login}")
    print("Logged in.")

    # The group query needs the product series of your robot; the official app
    # takes it from your registered devices.
    candidates = []
    for method, path in (("GET", "/machine/productSeriesMachine/queryProductSeriesByUser"),
                         ("POST", "/machine/productSeriesMachine/queryDevices"),
                         ("POST", "/machine/querySingleDevices")):
        resp = call(method, path, token, {} if method == "POST" else None)
        collect_series(resp, candidates)
    candidates = [c for c in candidates if isinstance(c, str)] or ["O38", "O58"]
    print("Product series to try:", candidates)

    drills, seen = [], set()
    for sid in candidates:
        page = 1
        while True:
            body = {"groupName": "", "pageNum": page, "pageSize": 50, "type": 2, "isMine": 1, "productSeries": sid}
            resp = call("POST", "/machine/userGroup/queryUserGroup", token, body, tag=f"_{sid}_{page}")
            rows = [r for r in rows_of(resp) if isinstance(r, dict)]
            new = []
            for r in rows:
                key = (r.get("productSeries", sid), r.get("groupSeriesId") or r.get("groupCode") or r.get("groupName"))
                if key not in seen:
                    seen.add(key)
                    new.append(dict(r, productSeries=r.get("productSeries", sid)))
            drills += new
            if new:
                print(f"  {sid}: page {page}, {len(new)} drills")
            if len(rows) < body["pageSize"]:
                break
            page += 1

    # The list only has drill metadata; the balls come from the detail call.
    (RAW / "details").mkdir(exist_ok=True)
    for i, r in enumerate(drills, 1):
        gid = r.get("groupSeriesId")
        print(f"  details {i}/{len(drills)}: {r.get('groupName')}", end=chr(13))
        # Official app: ApiDeviceService.queryGroupSeriesById (also used for custom drills).
        detail = call("GET", f"/machine/sysGroup/queryGroupDetail/{gid}", token, sub="details")
        r["detail"] = detail.get("data") if isinstance(detail, dict) else detail
        r["model"] = SERIES_MODEL.get(r["productSeries"], "")
    print()

    # Editor field limits per robot (queryUserGroupSettingConfig), kept for reference.
    for series in SERIES_MODEL:
        call("GET", f"/machine/groupConfig/queryGroupCustomerParam/{series}", token, sub="details")

    out.write_text(json.dumps({"rows": drills}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Saved {len(drills)} drills to {out}. Raw responses are in {RAW}/.")
    if not drills:
        print("No drills found. The machine_*.json files in official_raw/ show what the server returned "
              "(auth_login_userlogin_POST.json holds your session token, so don't share that one).")


if __name__ == "__main__":
    main()
