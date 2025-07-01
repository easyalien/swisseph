# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Swiss Ephemeris (SE) is a high-precision astronomical library for calculating planetary positions and astrological calculations. It was developed by Dieter Koch and Alois Treindl at Astrodienst AG and is used worldwide by astrological programmers. The library is built on NASA JPL astronomical data and provides extraordinary precision.

## Build System

The project uses a comprehensive Makefile that automatically detects the operating system (Linux/macOS) and sets appropriate compiler flags.

### Primary Build Commands

```bash
# Build all executables (swetest, swevents, swemini, and swetests on Linux)
make all

# Build individual executables
make swetest      # Main test program using libswe.a
make swevents     # Events calculation program
make swemini      # Minimal example program
make swetests     # Fully statically linked version (Linux only)

# Build libraries
make libswe.a           # Static library
make libswe.so          # Shared library (Linux)
make libswe.dylib       # Shared library (macOS)

# Run tests
make test               # Run test suite from setest directory
cd setest && make test  # Alternative test running

# Clean build artifacts
make clean
```

### Usage Examples

```bash
# Get Jupiter's position on a specific date/time (using Swiss Ephemeris files for highest precision)
./swetest -edir./ephe -p5 -b14.10.2020 -utc13:43:00 -fPTL

# Planet codes: 0=Sun, 1=Moon, 2=Mercury, 3=Venus, 4=Mars, 5=Jupiter, 6=Saturn, 7=Uranus, 8=Neptune, 9=Pluto
# Format codes: P=Planet name, T=Time, L=Longitude in degrees/minutes/seconds
```

## Core Architecture

### Library Structure
- **Core Library**: Static library (`libswe.a`) built from object files
- **Main Components**:
  - `sweph.c/h` - Core ephemeris calculations
  - `swephlib.c/h` - Library utilities and helper functions
  - `swedate.c/h` - Date and time handling
  - `swehouse.c/h` - Astrological house calculations
  - `swejpl.c/h` - JPL ephemeris file handling
  - `swemmoon.c`, `swemplan.c` - Moon and planet calculations
  - `swecl.c`, `swehel.c` - Eclipse and heliacal calculations

### Public API
- **Primary Header**: `swephexp.h` - Contains all public API definitions and constants
- **Function Prefix**: All public functions start with `swe_`
- **Key Functions**: Planet calculations, house systems, eclipse calculations, date conversions

### Executables
- **swetest**: Main test and demonstration program showing library capabilities
- **swevents**: Event calculation program (marked as unsupported/community maintained)
- **swemini**: Minimal example showing basic library usage

### Data Files
- **Ephemeris Data**: Located in `ephe/` directory
  - Compressed planetary files: `sepl*.se1`, `semo*.se1`, `seas*.se1`
  - Asteroid files organized in `ast[N]/` subdirectories
  - JPL files: `de200.eph`, `de406.eph`, `de431.eph`, `de441.eph`
- **Configuration**: `seleapsec.txt`, `sefstars.txt`, `seorbel.txt`

### Test Suite
- **Location**: `setest/` directory with its own Makefile
- **Test Framework**: Custom C test framework with multiple test suites
- **Test Files**: `suite_*.c` files covering different calculation areas
- **Running Tests**: Use `make test` from setest directory

## Key Development Patterns

### Error Handling
- Functions typically return error codes or use global error state
- Check return values and error messages for robustness

### Memory Management
- Library manages its own internal memory for ephemeris data
- Users typically don't need to manage memory for calculation results

### Thread Safety
- Library has internal state that may not be thread-safe
- Consider synchronization for multi-threaded applications

### Path Configuration
- Ephemeris path can be set via `swe_set_ephe_path()` function
- Default paths: Windows: `\sweph\ephe`, Unix: `".:/users/ephe2/:/users/ephe/"`
- Environment variables can override built-in defaults
- **For highest precision**: Use `-edir./ephe` to access Swiss Ephemeris files in the repository
- Without proper path, swetest falls back to built-in Moshier ephemeris (slightly less precise)

## Platform Specifics

### Linux
- Supports both dynamic and fully static linking
- Static executable: `swetests` (fully statically linked)
- Libraries: `libswe.a` (static), `libswe.so` (shared)

### macOS
- Dynamic linking only (static linking not supported)
- Libraries: `libswe.a` (static), `libswe.dylib` (shared)

### Windows
- Separate build system in `windows/` directory
- Pre-compiled executables available in `windows/programs/`

## API Development

A comprehensive Technical Requirements Document (TRD) for building a Swiss Ephemeris API service is available in `TRD_Swiss_Ephemeris_API.md`. The TRD outlines a phased approach:

- **Phase 1 (MVP)**: Node.js/Express API with basic caching, targeting 50 RPS
- **Phase 2 (Scaling)**: Process clustering, Redis caching, 500+ RPS capacity
- **Architecture**: Process pools for swetest binary calls, multi-tier caching, monitoring

The API provides planetary positions for all major celestial bodies via REST endpoints with JSON responses.

## License

Dual licensed under AGPL v3 or Swiss Ephemeris Professional License. When modifying code, ensure compliance with chosen license model.