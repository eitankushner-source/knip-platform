# ADR-001: Foundation Runtime

## Status
Accepted

## Decision
Use a dependency-free Node.js 20 service for the first Alpha Foundation release.

## Context
Earlier prototypes suffered from package installation, framework, Docker, and database generation failures. The first fresh baseline must be reproducible and easy to operate on Windows 11.

## Consequences
The foundation is highly reliable and easy to run. Framework, database, and authentication choices remain open for the next milestone and will be introduced deliberately rather than as hidden complexity.
