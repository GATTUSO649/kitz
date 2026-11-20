# MATRIX Biometric Engine (MBE) Hardware Compatibility Report

**Report date:** 2026-11-20

## Executive decision

**Independent fingerprint recognition is not currently implementable on this laptop.** The detected reader is exposed as a Windows Biometric Framework (WBF) sensor using Synaptics WBF adapters. No independent capture SDK, template extraction API, or template matching API was found for the exact hardware.

MATRIX must stop independent-engine implementation rather than substitute WebAuthn, Windows Hello, or generic image matching.

## Computer

- Manufacturer: HP
- Model: HP EliteBook 840 G5
- Windows: Windows 10 Pro, version 2009, build 26300, 64-bit
- Windows Biometric Service: `WbioSrvc`, running and automatic

## Fingerprint reader

- Manufacturer: Synaptics Incorporated
- Friendly name: `Synaptics VFS7552 Touch Fingerprint Sensor with PurePrint(TM)`
- Hardware ID: `USB\VID_138A&PID_00AB&REV_0164`
- Compatible hardware ID: `USB\VID_138A&PID_00AB`
- Instance ID: `USB\VID_138A&PID_00AB\8CC8B48664FA`
- Interface: Internal USB through USB 3.0 root hub
- Location: `Port_#0008.Hub_#0002`
- PnP location: `PCIROOT(0)#PCI(1400)#USBROOT(0)#USB(8)`
- PnP class: Biometric
- Device status: Working properly

## Driver

- Provider: Synaptics Incorporated
- Driver version: `5.5.28.1099`
- Driver date: 2021-04-28
- INF: `oem27.inf`
- INF section: `Biometric_Install_DFx.NTamd64`
- INF source package: `synaWudfBiousbHP.inf`
- Host service: `WUDFRd`
- UMDF library: `C:\Windows\System32\drivers\UMDF\synaWudfBiousb.dll`
- UMDF library version: `5.5.28.1099`

## Windows biometric binding

The active INF configures the sensor as an advanced WBF sensor:

- Sensor adapter: `synaAdvAdapter.dll`
- Engine adapter: `synaAdvAdapter.dll`
- Storage adapter: `synaAdvAdapter.dll`
- WBF database ID: `{F9E92F37-2B98-402A-9AA3-465EACA1D030}`
- Database path: `C:\Windows\System32\WinBioDatabase\F9E92F37-2B98-402A-9AA3-465EACA1D030.DAT`
- WBF plug-in: `C:\Windows\System32\WinBioPlugIns\synaAdvAdapter.dll`

The INF includes `SignatureAttributes.WindowsHello` for `synaAdvAdapter.dll`. This is evidence that the installed device path is integrated with Windows biometric infrastructure and Windows Hello-compatible signing, not a MATRIX-owned matching engine.

## Independent SDK investigation

### Evidence found

- Synaptics UMDF sensor driver.
- Synaptics WBF sensor/engine/storage compound adapter.
- Windows `winbio.dll` and WBF plug-ins.
- Synaptics-specific WBF database registration.
- Windows Hello authentication component registration.

### Evidence not found

- No standalone Synaptics SDK package in `C:\Program Files` or `C:\Program Files (x86)`.
- No standalone VFS7552 SDK package in standard installed-program locations.
- No independent enrollment, capture, feature extraction, or template matching executable or library identified.
- No public vendor SDK/API contract was found that documents capture and matching for exact hardware ID `VID_138A&PID_00AB`.
- No separate vendor matching engine or matrix template format was identified.

## Capability conclusion

This hardware currently exposes only the vendor-adapter/WBF path observable on the laptop:

- Capture is owned through WBF/Synaptics adapters.
- Feature extraction and matching are owned by the Synaptics WBF engine adapter.
- Templates are stored in a Synaptics-specific Windows WBF database.
- MATRIX cannot obtain raw images or independently generated templates from the installed API surface.
- The browser and server cannot determine which local verifier produced a result beyond WBF user verification.

Therefore:

- Independent template generation is not possible with the installed components.
- Independent fingerprint matching is not possible with the installed components.
- Duplicate enrollment detection, FAR/FRR measurement, and threshold configuration cannot be implemented against vendor-owned templates.
- A native Windows service built directly around this hardware would be an unsupported wrapper around WinUSB/WUDF internals or Windows Hello and would violate the hardware security boundary.

## Vendor SDK and licensing status

**SDK selected:** None.

**Licensing status:** Not available. The installed HP/Synaptics WBF driver package is not a public application SDK and does not provide a licensed independent recognition API.

A private Synaptics OEM/ODM SDK would require HP and/or Synaptics authorization and a supported license. It must provide, at minimum:

1. Exact VFS7552 or WBF-adapter integration support.
2. Fingerprint image or supported feature extraction.
3. MATRIX-owned protected template generation.
4. MATRIX-owned template matching and configurable thresholds.
5. Quality guidance and poor-capture detection.
6. Driver/firmware support documentation and redistribution terms.
7. A technically supported capture API.

A valid SDK contract must be reviewed before any native service is developed.

## Required blocker resolution

Independent implementation requires one of the following:

1. An official HP/Synaptics licensed SDK for VID_138A/PID_00AB.
2. A vendor-supported replacement driver and SDK that expose capture and matching and are legally redistributable.
3. A certified alternate fingerprint reader with independent SDK support and a validated Windows native integration.

Installing a generic Synaptics driver, changing the INF, or reverse-engineering WUDF/WinUSB protocols is not acceptable.

## Security boundary

Do not implement:

- A browser Boolean such as `fingerprintVerified=true`.
- Image-similarity matching.
- Synthetic or fake templates.
- Claims that a fingerprint-only result was obtained from WBF.
- Direct access to WinUSB or the UMDF sensor driver without vendor authorization.
- Raw fingerprint sample or template APIs that bypass Windows security protections.

Existing WebAuthn functionality may remain as a server-verified platform-authenticator feature, but it must not be presented as an independent MATRIX fingerprint recognition engine.

## What was verified

- Exact HP computer model.
- Exact Synaptics sensor model.
- USB hardware and compatible IDs.
- Active PnP status.
- Driver provider, version, date, INF, and UMDF service.
- WBF service state.
- Synaptics WBF sensor, engine, and storage adapters.
- Synaptics-specific WBF database registration.
- Absence of an independent SDK package in standard installed locations.

## Status

**MBE implementation status: STOPPED pending compatible licensed vendor SDK or replacement hardware.**

No native capture service, template database, matching implementation, FAR/FRR test, or hardware enrollment should be claimed as complete until independent capture and matching are demonstrated on the actual device.

## Standards-based passkey compatibility

The separate MATRIX WebAuthn/passkey implementation may still support compatible modern browsers on Windows, macOS, ChromeOS, Linux, Android, and external security keys. It uses server-issued challenges, public-key signature verification, credential ownership checks, user verification, and revocation.

This passkey compatibility is not evidence of MATRIX-owned fingerprint recognition. It does not expose or claim a fingerprint modality, raw image, or vendor template. Independent MBE capture and matching remain blocked as described above.
