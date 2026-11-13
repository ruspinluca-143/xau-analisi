# Avvisi sul telefono anche con l'app chiusa

Solo analisi: nessun ordine. Funziona così: ogni 5 minuti GitHub (gratis) controlla l'oro; se c'è un **segnale favorevole appena scattato**, ti manda una notifica sul telefono con l'app **ntfy**. L'app XAU può restare chiusa.

## Cosa serve (una volta sola, 5 minuti)
1. **Sul telefono:** installa **ntfy** (App Store o Google Play, gratis, senza account). Aprila, tocca **+** e iscriviti a un *argomento* (topic) con un nome lungo e segreto, per esempio `xau-xxxx-scrivi-14-lettere-e-numeri-a-caso`. Chi conosce il nome può leggere i messaggi, quindi non condividerlo.
2. **Su GitHub:** apri il repository `xau-analisi` → **Settings → Secrets and variables → Actions → New repository secret**. Nome: `NTFY_TOPIC`. Valore: lo stesso nome dell'argomento. Salva.
3. **Attiva il controllo:** scheda **Actions** del repository. Se compare il pulsante verde "I understand my workflows, go ahead and enable them", cliccalo. Poi scegli **Avvisi → Run workflow**: arriva sul telefono un messaggio di prova ("Prova avvisi XAU"). Se lo ricevi, è tutto collegato.

## Cosa controlla
- Oro (XAUUSD): breakout a **5 minuti, 15 minuti, 30 minuti, 1 ora, 4 ore, giornaliero e settimanale**, più le aperture di **Londra e New York** (a 5 e a 15 minuti); buy e short; tutti i target da 1R a 5R. Non c'è il time frame a 1 minuto: Yahoo dà solo 7 giorni di storia, troppo pochi per giudicare. Per giornaliero e settimanale conta solo la barra già chiusa.
- **Avvisa solo i segnali favorevoli** (simulazione e storico concordano, almeno 10 casi) appena scattati. Un solo messaggio per segnale.
- **Registra TUTTI i segnali** (anche non favorevoli, col loro giudizio) e li segue fino all'esito. Per quelli favorevoli ti manda una **seconda notifica con com'è andata**: target raggiunto, stop colpito, oppure chiuso senza target né stop, con il risultato in R. Così, se ti sei perso il segnale, sai comunque se era buono.
- Nell'app, schermata **Avvisi → "Segnali automatici"**: l'elenco di tutti i segnali con l'esito, quanti favorevoli sono andati a target e a stop, il win rate, il R totale e la curva: è il tuo backtest in tempo reale. Il registro sta nel ramo `dati` del repository (file `log.json`), tenuto per 90 giorni.
- Per cambiare time frame o regole: le costanti in cima a `notify.py`.

## Cose da sapere (onestamente)
- **Non è istantaneo:** GitHub esegue il controllo ogni 5 minuti ma può ritardarlo di diversi minuti nelle ore di punta. Un segnale a 5 minuti può arrivare quando è già vecchio. Per i time frame lunghi (1 ora in su) il ritardo conta poco.
- **Il backtest non è una garanzia:** sono pochi segnali, soprattutto all'inizio; un risultato positivo su pochi casi può essere fortuna. Guarda il numero di segnali prima di fidarti delle percentuali.
- **Yahoo dai server di GitHub non è mai stato provato.** Se i dati non arrivano, il messaggio di prova arriva lo stesso ma i segnali no: lo vedi nella scheda Actions (registro del controllo).
- **GitHub spegne i controlli automatici** dopo 60 giorni senza nessuna modifica al repository: basta un piccolo aggiornamento per riattivarli.
- **ntfy.sh** è un servizio pubblico gratuito: il testo del messaggio passa da lì (nessun dato personale, solo prezzi e livelli).
- **Il registro è pubblico** (il repository è pubblico): contiene solo segnali e prezzi di mercato, nessun dato personale.
- I prezzi nei messaggi e nel registro sono quelli dei dati: confrontali con il tuo grafico MT5.
- Gli avvisi dell'app (suono e notifica del browser) restano, ma solo con l'app aperta.
