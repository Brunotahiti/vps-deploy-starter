# Agent d'impression ManaResto

Petit programme à lancer sur un ordinateur (ou Raspberry Pi) du restaurant, connecté au même réseau que les imprimantes thermiques ESC/POS. La tablette de caisse lui envoie les tickets, il les transmet à l'imprimante.

```bash
node print-agent.mjs --port 9123 --printer 192.168.1.50:9100
```

Puis dans ManaResto : **Administration → Intégrations → Imprimantes → Nouvelle imprimante**, pilote « Agent d'impression local », URL `http://<ip-du-pc>:9123/print`.

Quand ManaResto tourne lui-même sur le réseau du restaurant (Mac, mini-PC), préférez le pilote « Réseau ESC/POS » : le serveur imprime directement, sans agent.

Option `--token secret` pour exiger un en-tête `Authorization: Bearer secret` (à renseigner dans l'URL de l'agent sous la forme `http://user:secret@…` n'est pas supporté ; utilisez un réseau de confiance).
