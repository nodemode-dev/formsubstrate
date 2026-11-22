#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
echo "Installing Substrate. This can take a few minutes."
echo
if ./formsubstrate_oc_install; then
  echo
  printf "Substrate is installed. Start it now? [Y/n] "
  read -r answer
  case "${answer:-y}" in
    [Yy]*) ./formsubstrate ;;
    *) echo "Start it any time with ./formsubstrate in this folder." ;;
  esac
else
  echo
  echo "The install stopped. Read the message above, fix it, and run this file again."
fi
echo
printf "Press Enter to close this window. "
read -r _
