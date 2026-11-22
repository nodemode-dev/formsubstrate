#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
echo "Installing subform. This can take a few minutes."
echo
if ./subform_oc_install; then
  echo
  printf "subform is installed. Start it now? [Y/n] "
  read -r answer
  case "${answer:-y}" in
    [Yy]*) ./subform ;;
    *) echo "Start it any time with ./subform in this folder." ;;
  esac
else
  echo
  echo "The install stopped. Read the message above, fix it, and run this file again."
fi
echo
printf "Press Enter to close this window. "
read -r _
