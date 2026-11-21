#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# != 1 || -z "$1" ]]; then
  printf 'Usage: %s <out-dir>\n' "$0" >&2
  exit 2
fi

out_dir=$1
[[ "$out_dir" = /* ]] || out_dir="$PWD/$out_dir"
if [[ -L "$out_dir" ]]; then
  printf 'Choose a directory instead of a symlink at %s\n' "$out_dir" >&2
  exit 1
fi
mkdir -p "$out_dir"
work_dir="$out_dir/.make-mac-signing-cert"
mkdir "$work_dir"
trap 'rm -rf "$work_dir"' EXIT
trap 'exit 1' HUP INT TERM

files=(cert.p12 cert.p12.base64 password.txt)
for file in "${files[@]}"; do
  if [[ -e "$out_dir/$file" || -L "$out_dir/$file" ]]; then
    printf 'A signing file already exists at %s\n' "$out_dir/$file" >&2
    exit 1
  fi
done
cat > "$work_dir/openssl.cnf" <<'CONFIG'
[req]
distinguished_name = subject
x509_extensions = signing
prompt = no

[subject]
CN = T3 Code Fork Signing

[signing]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
CONFIG

openssl rand -hex 32 > "$work_dir/password.txt"
openssl req -new -x509 -newkey rsa:3072 -nodes -sha256 -days 4018 \
  -config "$work_dir/openssl.cnf" -keyout "$work_dir/key.pem" -out "$work_dir/cert.pem"

# macOS security import accepts this PKCS#12 encoding with both LibreSSL and OpenSSL 3.
openssl pkcs12 -export -inkey "$work_dir/key.pem" -in "$work_dir/cert.pem" \
  -name 'T3 Code Fork Signing' -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
  -passout "file:$work_dir/password.txt" -out "$work_dir/cert.p12"
openssl base64 -A -in "$work_dir/cert.p12" -out "$work_dir/cert.p12.base64"

for file in "${files[@]}"; do
  mv "$work_dir/$file" "$out_dir/$file"
done
printf 'Created fork signing certificate in %s\n' "$out_dir"
