#!/bin/bash
# Installe « ma version » de tokentaby sur ce Mac, en une fois.
# À lancer dans le Terminal :  bash ~/dev/tokentaby/installer-ma-version.sh
set -e
cd "$HOME/dev/tokentaby"
ok() { printf '\n\033[32m✔ %s\033[0m\n' "$1"; }
step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }

step "1/5  Envoi du code vers ton fork GitHub (MathLemLaf/tokentaby)"
git remote set-url origin https://github.com/MathLemLaf/tokentaby.git
git fetch -q origin
if git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  echo "Déjà à jour sur GitHub."
elif git merge-base --is-ancestor origin/main HEAD; then
  git push -q origin HEAD:main
else
  echo "Ton fork a des commits que je n'ai pas : je pousse sur la branche ma-version (pas sur main)."
  git push -q -u origin HEAD:ma-version
fi
ok "Code sur GitHub"

step "2/5  Commande « tokentaby » dans le terminal"
# pas de npm -g : /usr/local n'est pas modifiable sans sudo. Petit lanceur dans ~/.local/bin.
mkdir -p "$HOME/.local/bin"
cat > "$HOME/.local/bin/tokentaby" <<'LANCEUR'
#!/bin/bash
exec node "$HOME/dev/tokentaby/scripts/tokentaby.js" "$@"
LANCEUR
chmod +x "$HOME/.local/bin/tokentaby"
if ! grep -q '.local/bin' "$HOME/.zshrc" 2>/dev/null; then
  printf '\n# tokentaby\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$HOME/.zshrc"
fi
export PATH="$HOME/.local/bin:$PATH"
tokentaby --version
ok "CLI installée"

step "3/5  Plugin Claude Code"
claude plugin marketplace add MathLemLaf/tokentaby || claude plugin marketplace update tokentaby-math
claude plugin install tokentaby@tokentaby-math --config dev_id=math --config hub="$HOME/dev/tokentaby-data" \
  || claude plugin install tokentaby@tokentaby-math
ok "Plugin installé (redémarre Claude Code ou tape /reload-plugins dans une session ouverte)"

step "4/5  Hub central ~/dev/tokentaby-data"
tokentaby hub init "$HOME/dev/tokentaby-data" --push
cd "$HOME/dev/tokentaby-data"
git add -A
git commit -qm "init hub tokentaby" || true
ok "Hub prêt"

step "5/5  Dépôt GitHub PRIVÉ pour les données (MathLemLaf/tokentaby-data)"
if git remote | grep -q origin; then
  echo "Le hub a déjà une remote : $(git remote get-url origin)"
elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  gh repo create MathLemLaf/tokentaby-data --private --source . --push
  ok "Dépôt privé créé et poussé"
else
  echo "gh (GitHub CLI) n'est pas installé ou pas connecté. Deux options :"
  echo "  a) brew install gh && gh auth login   puis relance ce script"
  echo "  b) crée un dépôt PRIVÉ vide « tokentaby-data » sur github.com/new, puis :"
  echo "     cd ~/dev/tokentaby-data && git remote add origin https://github.com/MathLemLaf/tokentaby-data.git && git push -u origin main"
fi

printf '\n\033[1mTerminé.\033[0m Prochaines étapes :\n'
echo "  • Ouvre une session Claude Code n'importe où, puis tape :  /tokentaby:backfill   (importe ton historique)"
echo "  • Vérifie le classement :  tokentaby hub rules"
echo "  • Tableau de bord :        tokentaby serve"
