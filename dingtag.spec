# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec — ดับเบิลคลิกเปิดได้ ไม่ขอสิทธิ์ Admin (manifest เริ่มต้น = asInvoker)
# รัน: pyinstaller dingtag.spec --noconfirm

import os

spec_root = os.path.dirname(os.path.abspath(SPEC))

from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = []

for pkg in ("customtkinter", "uvicorn", "starlette", "anyio", "pydantic", "pydantic_core", "httpx", "certifi"):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:
        pass

_automatron_ico = os.path.join(spec_root, "Automatron.ico")
if os.path.isfile(_automatron_ico):
    datas.append((_automatron_ico, "."))

block_cipher = None

a = Analysis(
    [os.path.join(spec_root, "aibot_dingver.py")],
    pathex=[spec_root],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports
    + [
        "uvicorn.loops.auto",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan.on",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

_exe_kw = dict(
    name="AuToMaTron",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
if os.path.isfile(_automatron_ico):
    _exe_kw["icon"] = _automatron_ico

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    **_exe_kw,
)
