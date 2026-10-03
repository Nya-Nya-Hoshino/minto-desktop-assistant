; Install only for the current user, even when launched from an elevated shell.
; The Python/voice runtime and its runtime DLLs are already included.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
