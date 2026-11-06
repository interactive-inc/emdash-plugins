#!/bin/sh
set -eu

if [ "${1-}" = "--" ]; then shift; fi
if [ "$#" -eq 0 ]; then
  set -- tests/*/*.test.ts tests/*/*.test.tsx
fi

exec tsx --experimental-test-module-mocks --test "$@"
