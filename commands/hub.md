---
description: Hub central — où vont les données, comment chaque dossier est classé, envoi vers GitHub
argument-hint: "[where|rules|sync|init <dossier> --push]"
allowed-tools: Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/tokentaby.js" hub:*)
disable-model-invocation: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/tokentaby.js" hub --data-dir "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS`

La sortie ci-dessus vient de la CLI tokentaby. Montre-la telle quelle dans un bloc de code, puis ajoute au plus une courte ligne seulement si elle signale une erreur ou une prochaine étape. Les coûts sont des estimations en équivalent API, jamais une facture. Ne lance pas d'autres commandes sauf si l'utilisateur le demande.
