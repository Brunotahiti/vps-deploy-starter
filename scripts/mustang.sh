#!/usr/bin/env bash
# Validateur officiel Mustang (Factur-X / ZUGFeRD, norme EN 16931) : https://www.mustangproject.org
#   scripts/mustang.sh facture.pdf          → valide une facture électronique (code de sortie 0 si valide)
#   scripts/mustang.sh --action extract --source facture.pdf --out facture.xml
# Le programme (Java, ~60 Mo) est téléchargé une fois dans ~/.cache/mustang depuis Maven Central, empreinte vérifiée.
set -euo pipefail
VERSION="${MUSTANG_VERSION:-2.26.0}"
SHA1="${MUSTANG_SHA1:-8755fc333032f802ad7dcf3930201edfe64014e2}"
DIR="${MUSTANG_DIR:-$HOME/.cache/mustang}"
JAR="${MUSTANG_JAR:-$DIR/Mustang-CLI-$VERSION.jar}"
command -v java >/dev/null || { echo "Java (17 ou plus récent) est nécessaire : https://adoptium.net" >&2; exit 2; }
if [ ! -f "$JAR" ]; then
  mkdir -p "$(dirname "$JAR")"
  echo "Téléchargement de Mustang CLI $VERSION…" >&2
  curl -fsSL -o "$JAR.part" "https://repo1.maven.org/maven2/org/mustangproject/Mustang-CLI/$VERSION/Mustang-CLI-$VERSION.jar"
  if [ "$VERSION" = "2.26.0" ] || [ -n "${MUSTANG_SHA1:-}" ]; then
    echo "$SHA1  $JAR.part" | sha1sum -c - >/dev/null || { echo "Empreinte du téléchargement incorrecte" >&2; rm -f "$JAR.part"; exit 3; }
  fi
  mv "$JAR.part" "$JAR"
fi
if [ $# -eq 1 ] && [ -f "$1" ]; then
  # Validation : le rapport XML de Mustang est affiché, le code de sortie vaut 0 si la facture est valide
  exec java -Xmx512m -jar "$JAR" --action validate --source "$1"
fi
exec java -Xmx512m -jar "$JAR" "$@"
