# Hub tokentaby — tout mon usage de Claude Code

Ce dépôt est **privé**. Il reçoit automatiquement l'usage de Claude Code de tous mes dossiers
(tokens, modèle, agent, prompts tronqués, coût estimé), étiqueté par dossier.

- `.tokentaby/devs/<moi>/AAAA-MM.ndjson` : les données (une ligne JSON par événement)
- `.tokentaby/spheres.json` : les règles qui rangent chaque dossier dans une **sphère**, une **application** et un **type**
- `.tokentaby/config.json` : réglages (prompts, envoi automatique vers GitHub)

Commandes utiles :

```bash
tokentaby summary          # aujourd'hui / semaine / mois, avec la répartition par sphère
tokentaby serve            # tableau de bord sur http://localhost:7331 (onglet « Sphères »)
tokentaby hub rules        # comment chaque dossier est classé
tokentaby hub sync         # envoyer sur GitHub maintenant
tokentaby backfill         # réimporter l'historique de ~/.claude/projects
```

Les coûts sont des **estimations au prix de l'API**, pas une facture (abonnement Pro/Max).
Ne rends jamais ce dépôt public : il contient le début de tes prompts.
