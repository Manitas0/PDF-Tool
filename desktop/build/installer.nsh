; Included by electron-builder in the NSIS installer (default of "nsis.include": build/installer.nsh).
;
; electron-builder 26.17.0 sets the disk space the installer needs (shown on the directory page and
; checked against the free space of the target drive) only for installers that contain an x64 or
; x86 build (setSpaceRequired in app-builder-lib/templates/nsis/common.nsh). The arm64 installer
; contains only the arm64 build ("buildUniversalInstaller": false), so it would ask for the size of
; the compressed archive (about 110 MB) instead of the installed size (about 370 MB). Set the size
; for that case only; the x64 installer is not changed. Section 0 is the installer's only section
; ("install"); its name INSTALL_SECTION_ID is not defined yet in .onInit, where customInit runs.
!ifdef APP_ARM64_UNPACKED_SIZE
  !ifndef APP_64_UNPACKED_SIZE
    !ifndef APP_32_UNPACKED_SIZE
      !macro customInit
        SectionSetSize 0 ${APP_ARM64_UNPACKED_SIZE}
      !macroend
    !endif
  !endif
!endif
