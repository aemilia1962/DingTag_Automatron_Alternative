@echo off
setlocal
cd /d "%~dp0"

echo [1/3] Installing dependencies + PyInstaller...
python -m pip install -q -r requirements.txt pyinstaller || exit /b 1

echo [2/3] Building AuToMaTron.exe ^(icon: Automatron.ico^)...
if not exist Automatron.ico (
    echo ERROR: Automatron.ico not found next to this script. Place Automatron.ico in the project folder.
    exit /b 1
)
python -m PyInstaller dingtag.spec --noconfirm || exit /b 1

echo.
echo Done. Output:
echo   %CD%\dist\AuToMaTron.exe
echo.
echo Zip ^ dist\AuToMaTron.exe ^ and send. Recipient puts exe in a folder they can write to ^(Desktop/Downloads^)^;
echo config.json will appear next to the exe on first run.
pause
