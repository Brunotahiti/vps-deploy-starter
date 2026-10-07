# Agent d'impression ManaResto (imprimantes Wi-Fi du restaurant)

Petit programme sans dépendance à lancer sur un ordinateur (PC, Mac) ou un Raspberry Pi du restaurant, connecté au même réseau (Wi-Fi ou box) que les imprimantes thermiques ESC/POS. La caisse lui envoie les tickets, il les transmet à l'imprimante (TCP, port 9100). **Un seul agent sert toutes les imprimantes Wi-Fi du restaurant.**

```bash
node print-agent.mjs --port 9123 --printer 192.168.1.50:9100 [--printer 192.168.1.51] [--token secret]
```

Puis dans ManaResto : **Gestion → Imprimantes & tiroir-caisse → Ajouter une imprimante → « Imprimante Wi-Fi ou réseau du restaurant »** : adresse IP de l'imprimante (ex. `192.168.1.50`, port `9100`) et adresse de l'agent (`http://<ip-du-pc>:9123/print`). Chaque ticket arrive avec l'adresse de l'imprimante visée ; sans adresse, l'agent imprime sur la première imprimante donnée par `--printer`.

## Relier une imprimante Wi-Fi

1. Connecter l'imprimante au Wi-Fi du restaurant : bouton WPS de la box puis de l'imprimante, ou l'utilitaire du fabricant (Epson TM Utility, Xprinter Tool, Star Quick Setup…).
2. Imprimer sa page d'état (bouton « Feed » maintenu à l'allumage) pour lire son adresse IP ; dans la box, lui réserver cette adresse (bail DHCP fixe).
3. Lancer l'agent sur un ordinateur du restaurant allumé pendant le service, puis déclarer l'imprimante dans ManaResto et faire « Tester ».

## Sécurité

- L'agent n'imprime que vers le **réseau local** : adresse privée (192.168.x.x, 10.x.x.x, 172.16-31.x.x, `.local`) sur un port d'impression (9100, 9101, 9102, 515), ou une adresse donnée par `--printer`. Jamais vers internet.
- `--token secret` exige un en-tête `Authorization: Bearer secret` (réseau partagé avec le public).
- `GET /status` répond `{ ok, printers }` pour vérifier que l'agent tourne.

## Impression sans internet

La caisse construit elle-même les tickets et les bons cuisine et les envoie à l'agent : l'impression continue pendant une coupure d'internet, tant que la tablette et l'agent sont sur le même Wi-Fi.

Une caisse ouverte en HTTPS (app.manaresto.com) ne peut joindre un agent en HTTP qu'à l'adresse `localhost` / `127.0.0.1` (agent lancé sur le même ordinateur que la caisse). Pour des tablettes (iPad, Android), l'agent doit être exposé en HTTPS avec un certificat valide : c'est ce que fait le boîtier de secours ManaResto (`tools/box-gateway`), qui imprime alors directement en réseau (pilote « Réseau local direct »).

Quand ManaResto tourne lui-même sur le réseau du restaurant (Mac, mini-PC, boîtier), préférez le pilote « Réseau local direct » : le serveur imprime sans agent.
