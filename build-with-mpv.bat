@echo off
REM Build SpotiFLAC with MPV support on Windows
REM This script ensures CGO is enabled and MPV DLL is accessible

echo ========================================
echo Building SpotiFLAC with MPV support
echo ========================================
echo.

REM Check if libmpv-2.dll exists in backend directory
if not exist "backend\libmpv-2.dll" (
    echo ERROR: libmpv-2.dll not found in backend directory!
    echo.
    echo Please download libmpv-2.dll and place it in the backend folder.
    echo Download from: https://sourceforge.net/projects/mpv-player-windows/files/libmpv/
    echo.
    pause
    exit /b 1
)

REM Check if mpv.lib exists
if not exist "backend\mpv.lib" (
    echo ERROR: mpv.lib not found in backend directory!
    echo.
    echo You need the import library (mpv.lib) for linking.
    echo.
    echo Option 1: Download pre-built libmpv dev package with .lib file
    echo Option 2: Generate from .def file using:
    echo    lib /def:mpv.def /out:backend\mpv.lib /machine:x64
    echo.
    pause
    exit /b 1
)

echo Found required files:
echo   - backend\libmpv-2.dll
echo   - backend\mpv.lib
echo.

REM Set CGO environment variables
echo Setting up CGO environment...
set CGO_ENABLED=1
set CGO_CFLAGS=-I%CD%\backend
set CGO_LDFLAGS=-L%CD%\backend -lmpv

echo CGO_ENABLED=%CGO_ENABLED%
echo CGO_CFLAGS=%CGO_CFLAGS%
echo CGO_LDFLAGS=%CGO_LDFLAGS%
echo.

REM Add backend directory to PATH so DLL can be found at runtime
echo Adding backend directory to PATH for runtime DLL loading...
set PATH=%CD%\backend;%PATH%
echo.

REM Build with Wails
echo Running wails build...
echo.
wails build -tags cgo

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo BUILD SUCCESSFUL!
    echo ========================================
    echo.
    echo The executable is in: build\bin\
    echo.
    echo IMPORTANT: Copy backend\libmpv-2.dll to the same folder as the .exe
    echo    copy backend\libmpv-2.dll build\bin\
    echo.
    echo Or the DLL won't be found when you run the application.
    echo.
    
    REM Automatically copy the DLL
    echo Copying libmpv-2.dll to build folder...
    if exist "build\bin\SpotiFLAC.exe" (
        copy /Y "backend\libmpv-2.dll" "build\bin\" >nul
        echo Done! You can now run build\bin\SpotiFLAC.exe
    )
    echo.
) else (
    echo.
    echo ========================================
    echo BUILD FAILED!
    echo ========================================
    echo.
    echo Check the error messages above.
    echo Common issues:
    echo   1. GCC not found - Install TDM-GCC or MinGW-w64
    echo   2. mpv.lib missing - See error message at top
    echo   3. CGO compilation errors - Check C compiler installation
    echo.
)

pause
