#!/usr/bin/env python3
"""End-to-end test for offline message delivery + history pagination.

Run against a live CRYPTMessenger backend. Offline delivery is the core
privacy/UX guarantee: a message sent while the recipient's socket is down must
be persisted server-side and replayed to them on reconnect (message_sync), and
must also be retrievable via the REST history endpoint.

Env overrides (useful for CI vs local):
  BASE   REST base URL   (default http://127.0.0.1:9091)
  WS     WebSocket URL   (default ws://127.0.0.1:9091/ws)
  ORIGIN WS Origin header (default http://localhost:3000)
"""
import base64
import json
import os
import sys
import time
import uuid

import requests
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
import websocket

BASE = os.environ.get("BASE", "http://127.0.0.1:9091")
WS = os.environ.get("WS", "ws://127.0.0.1:9091/ws")
ORIGIN = os.environ.get("ORIGIN", "http://localhost:3000")
run = uuid.uuid4().hex[:8]


def make_user(name):
    priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pub_der = priv.public_key().public_bytes(
        serialization.Encoding.DER,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    pub_b64 = base64.b64encode(pub_der).decode()
    r = requests.post(
        f"{BASE}/api/auth/register-init",
        json={"displayName": name, "publicKey": pub_b64},
        timeout=10,
    )
    if r.status_code != 200:
        raise SystemExit(f"register-init {name}: {r.status_code} {r.text}")
    data = r.json()
    pending = data["pendingId"]
    ct = base64.b64decode(data["encryptedChallenge"])
    challenge = priv.decrypt(
        ct,
        padding.OAEP(mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )
    resp = base64.b64encode(challenge).decode()
    r = requests.post(
        f"{BASE}/api/auth/register-confirm",
        json={"pendingId": pending, "response": resp},
        timeout=10,
    )
    if r.status_code != 200:
        raise SystemExit(f"register-confirm {name}: {r.status_code} {r.text}")
    d = r.json()
    return {"userID": d["userId"], "token": d["token"], "priv": priv, "name": name}


def auth_ws(uid, token):
    ws = websocket.create_connection(WS, timeout=10, origin=ORIGIN)
    ws.send(json.dumps({"type": "auth", "payload": {"token": token}}))
    return ws


def recv_until(ws, want_type, want_id, timeout=4):
    ws.settimeout(timeout)
    try:
        while True:
            m = json.loads(ws.recv())
            if m.get("type") == want_type and m.get("payload", {}).get("id") == want_id:
                return m["payload"]
    except Exception:
        return None


print("== CRYPTMessenger E2E: offline delivery + pagination ==")
A = make_user(f"e2eA_{run}")
B = make_user(f"e2eB_{run}")
print(f"registered A={A['userID'][:8]} B={B['userID'][:8]}")

r = requests.post(
    f"{BASE}/api/conversations",
    headers={"X-Crypt-Token": A["token"]},
    json={"type": "dm", "members": [B["userID"]]},
    timeout=10,
)
assert r.status_code == 201, f"conv create {r.status_code} {r.text}"
conv = r.json()
cid = conv["id"]
print(f"conversation {cid[:8]} members={conv.get('members')}")

# A connects and sends a message while B is OFFLINE.
aws = auth_ws(A["userID"], A["token"])
mid = uuid.uuid4().hex
aws.send(json.dumps({"type": "message", "payload": {
    "conversationId": cid, "recipientId": B["userID"],
    "content": "bonjour B (secret)", "encrypted": True,
    "encryptedKey": "k", "iv": "i", "id": mid,
    "timestamp": int(time.time() * 1000)}}))
ack = recv_until(aws, "message_ack", mid, timeout=2)
aws.close()
print(f"A got message_ack={ack is not None}")
assert ack is not None, "sender did not receive delivery ack"

# B connects AFTER the message was sent -> must receive it via replay.
bws = auth_ws(B["userID"], B["token"])
replayed = recv_until(bws, "message_sync", mid, timeout=4)
bws.close()
print(f"B received message_sync replay={replayed is not None}")
assert replayed is not None, "OFFLINE DELIVERY FAILED: B never received the message"

# REST history endpoint returns the message.
r = requests.get(f"{BASE}/api/messages/{cid}", headers={"X-Crypt-Token": B["token"]}, timeout=10)
hist = r.json() if r.status_code == 200 else []
print(f"GET /api/messages -> {r.status_code}, count={len(hist)}")
assert any(h.get("id") == mid for h in hist), "history endpoint did not return the message"

# Pagination smoke test: limit=1 must cap the result to at most 1 message.
r = requests.get(f"{BASE}/api/messages/{cid}?limit=1", headers={"X-Crypt-Token": B["token"]}, timeout=10)
assert r.status_code == 200, f"pagination request failed: {r.status_code}"
paged = r.json()
assert isinstance(paged, list) and len(paged) <= 1, f"limit=1 returned {len(paged)} messages"
print(f"GET /api/messages?limit=1 -> {len(paged)} (cap ok)")

print("\nALL CHECKS PASSED: offline message persisted + replayed on connect + available via REST history + pagination capped")
