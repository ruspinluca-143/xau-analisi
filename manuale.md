# Manuale d'uso — XAU Analisi

Questo manuale spiega come si usa ogni parte dell'app e a cosa serve. Si aggiorna a ogni modifica: la sezione "Novità" in alto dice cosa è cambiato e quando. Ultimo aggiornamento: 20/11/2026.

## Novità (ultime modifiche)

- **20/11/2026** — Nuovo: questo **manuale d'uso** dentro l'app (pulsante **?** in alto). Corretto: in Avvisi, nei Segnali automatici, i pulsanti delle categorie di "Dove sbagli" andavano fuori dal riquadro: ora vanno a capo.
- **20/11/2026** — Tolti i time frame **1 minuto** e **15 minuti**: restano 5m, 30m, 1h, 4h, 1d, 1w. L'apertura di Londra e di New York c'è solo a 5 minuti. I vecchi segnali su 1m e 15m non si vedono né si contano più.
- **20/11/2026** — Notifiche: se il servizio ntfy risponde "troppe richieste" (errore 429) l'app aspetta e riprova; i segnali favorevoli di un giro arrivano **in un solo messaggio**; tetto di 150 messaggi al giorno (i promemoria passano sempre); in Avvisi, "Notifiche sul telefono" mostra se il token è attivo e perché un invio fallisce.
- **19/11/2026** — Solo target **2R, 3R e 4R**. Nei **Segnali automatici** ci sono oro, titoli e cripto insieme, con **filtri** e la tabella **"Dove sbagli"**. Scanner acceso su 108 strumenti. Pulsante **Azzera da adesso**. Riepilogo di oggi sotto il prezzo.
- **18/11/2026** — Prezzo dell'oro quasi in tempo reale (circa 1 minuto di ritardo invece di 10). Nuove schede in Operazioni (E se…, Tu contro la regola, mappa giorno × ora, riepilogo fiscale). Quadro di mercato, sessioni dell'oro, reazione alla Fed. Spiegazioni "perché sì / perché no".

## 1. Cos'è e a cosa serve

**XAU Analisi** è un'app di sola analisi per l'oro (XAUUSD) e, come ricerca manuale, per azioni e cripto. Ti dice se, ripetendo le ultime barre reali, un'operazione di breakout avrebbe avuto un vantaggio statistico oppure no, e ti avvisa quando compare un segnale favorevole.

- **Non apre mai ordini** e non è collegata a nessun broker: l'operatività resta solo tua, su MetaTrader 5.
- **Non è una previsione.** Mostra cosa sarebbe successo in passato. Notizie e dati macro possono muovere il prezzo in modi che lo storico non contiene.
- **Dice la verità anche quando è scomoda:** "nessun vantaggio" non diventa "entra".
- **Gratis e senza chiavi.** I dati sono di Yahoo Finance e, per i minuti più recenti dell'oro, di un feed gratuito collegato all'oro.

## 2. Prima di cominciare

### Aprire e installare
- L'indirizzo è https://xau-analisi.onrender.com. Aprilo dal telefono e usa "Aggiungi a schermata Home" del browser: diventa un'icona come un'app.
- In basso c'è la barra con cinque schermate: **Oggi, Grafico, Time Machine, Avvisi, Operazioni**. Si passa da una all'altra anche scorrendo con il dito.
- Il pulsante **?** in alto apre questo manuale. Il pulsante tondo accanto aggiorna i dati.

### Dopo una novità
- **Chiudi e riapri l'app due volte** per caricare la versione nuova.

### Toccare i grafici e i riquadri
- Ogni riquadro si chiude e si apre **toccando il suo titolo**; resta chiuso anche dopo aver chiuso l'app.
- **Toccando un grafico** compaiono i dettagli del punto toccato (valori, date, numero di casi).

## 3. Come leggere i giudizi

- **Stop** è il livello dove il piano si considera sbagliato; **target** è il livello dove si incassa. **R** è il multiplo del rischio: se rischi 1 per arrivare al target a **2R**, il guadagno è il doppio del rischio.
- **Pareggio:** con target a 2R basta vincere il 33% delle volte per non perdere (1 diviso 1+R); a 3R il 25%; a 4R il 20%.
- **Simulazione (Time Machine):** 10.000 ripetizioni del resto della giornata, pescando barre reali. Dice quante volte il target arriva prima dello stop.
- **Storico reale:** tutte le volte in passato in cui la stessa regola è scattata, con quante sono andate a target, a stop e con quale R medio.
- **Giudizio:**
  - **Favorevole:** simulazione e storico concordano, con almeno 10 casi nello storico e un R medio sopra l'incertezza statistica.
  - **Sfavorevole:** la simulazione o lo storico dicono che in media si perde.
  - **Nessun vantaggio dimostrato:** non si distingue dal caso.
  - **Pochi casi:** non ci sono abbastanza casi per giudicare.
- **"Perché sì / perché no"** (in "Cosa dice l'analisi") elenca i motivi a favore e contro, solo dai numeri: margine sul pareggio, storico, tendenza a 20 giorni, RSI estremo, stop troppo stretto o largo, segnale non ancora scattato o in ritardo.

## 4. Schermata Oggi

A cosa serve: vedere subito cosa fa lo strumento e cosa dice l'analisi.

### Ricerca strumento
- Scrivi le prime lettere: "T" propone Tesla, "N" Nvidia. Invio sceglie il primo. Vale anche un simbolo di Yahoo (SPY, ^GSPC, EURUSD=X). L'oro è il predefinito.

### Prezzo e semaforo
- Il **prezzo** è aggiornato quasi in tempo reale per l'oro; sotto leggi "prezzo di N secondi fa" e l'ora dell'ultima barra chiusa. Se per l'oro compare "feed ritardato", il feed live non ha risposto e l'app sta usando i dati di Yahoo con circa 10 minuti di ritardo.
- **Semaforo del giorno:** dice se la giornata è tranquilla, nella norma o agitata confrontando il movimento di oggi con quello normale, la sessione in corso (Asia, Londra, New York) e quanto manca alla prossima notizia rossa.
- **Riepilogo di oggi:** i segnali favorevoli delle ultime 24 ore e le tue operazioni di oggi.
- **Prezzo su MT5:** i dati possono differire di qualche dollaro dal tuo grafico. Scrivi qui il prezzo che vedi su MT5 e i livelli si spostano di conseguenza.

### Pulsanti rapidi
- **Grafico, Time Machine, Avvisi:** portano alle rispettive schermate.
- **Opportunità:** controlla in un colpo solo tutti i gruppi (time frame e setup) con i target 2R, 3R e 4R, buy e short, e ti dice dove c'è un vantaggio adesso, dove sta per scattare e dove no. Se non c'è niente di favorevole lo dice.

### Scelte dell'analisi
- **Time frame:** 5m, 30m, 1h, 4h, 1d, 1w (la durata di ogni barra).
- **Setup:** **Breakout** (una barra chiude oltre il massimo o il minimo delle ultime 20 barre), oppure **Londra** / **New York** (rottura del range dei primi 15 minuti della sessione, solo a 5 minuti).
- **Target:** 2R, 3R o 4R.
- **BUY e SHORT:** per ciascuna direzione trovi ingresso, stop, target, il giudizio e se il segnale è già scattato o è in attesa.

### Cosa dice l'analisi
- Spiegazione in italiano di ciò che vedi, con i giudizi e, dopo ciascuno, **perché sì e perché no**.

### Tutti i time frame
- Una riga per ogni time frame con la tendenza (rialzista, ribassista, neutra), volatilità e RSI, e una lettura d'insieme.

### Chiedi a Claude
- Una chat per fare domande sull'analisi. È **spenta** finché non c'è una chiave API sul server: l'analisi qui sopra funziona lo stesso.

## 5. Grafico

A cosa serve: vedere le candele e i livelli del piano.

- Candele chiuse del time frame scelto, medie a 20 (blu) e 50 barre (viola), e le linee di ingresso, stop e target della direzione scelta.
- **Zoom:** pizzica con due dita (o rotella del mouse); trascina per spostarti; doppio tocco o ⟲ per ripristinare; **+** e **−** per ingrandire.
- **Le mie operazioni:** spunta per vedere sul grafico le tue operazioni caricate in Operazioni (triangolo = apertura, pallino verde o rosso = chiusura). Toccando un marcatore vedi i dettagli. Le righe provvisorie da video mostrano solo la chiusura.
- **Livelli chiave:** spunta per vedere massimo e minimo di ieri e dei 20 giorni e i numeri tondi ogni 50.

## 6. Time Machine

A cosa serve: vedere tutti i modi in cui l'operazione poteva finire.

- **Le 10.000 ripetizioni da adesso:** il ventaglio mostra l'intervallo dei percorsi del prezzo; tocca per vedere la percentuale dei casi.
- Percentuali di **target prima**, **stop prima** e **nessuno dei due**, R medio e giudizio.
- **Casistiche storiche:** ogni volta che la regola è scattata in passato, con l'esito. Tocca un caso per vederlo.
- Puoi leggere i grafici in **R** (multipli del rischio) o in **Prezzo**.

## 7. Avvisi

A cosa serve: farti arrivare i segnali e capire come stanno andando.

### Avvisi (nell'app)
- **Attiva avvisi:** con l'app aperta, suono e notifica del browser quando compare un segnale. Scegli i time frame, il tipo di segnale e se avvisare solo i favorevoli. **Prova suono** controlla l'audio.
- **Notifiche sul telefono** (stesso riquadro, in fondo): dice se le notifiche del server sono collegate, se il **token ntfy** è attivo, quando è partito l'ultimo messaggio e se il promemoria delle 7 di oggi è stato inviato. Il pulsante **Manda una notifica di prova** controlla subito se il telefono riceve. Se un invio fallisce, vedi il motivo (per esempio "429 troppe richieste").

### Notizie importanti in arrivo
- Solo gli eventi "rossi" (impatto alto) di USD, EUR, GBP: tassi, inflazione, lavoro USA, discorsi delle banche centrali. Orari in ora italiana. **Toccando un evento** vedi gli scenari: cosa tende a fare l'oro se il dato è sopra, in linea o sotto le attese. Sono regole generali, non percentuali né previsioni.

### Cosa scommette il mercato sui tassi
- Le probabilità del mercato di previsione Polymarket sulle prossime decisioni della Fed. Sono scommesse con soldi veri: un termometro delle aspettative, non una previsione dell'app.

### Segnali automatici
A cosa serve: l'elenco completo di tutti i segnali favorevoli trovati dal server da solo, anche con l'app chiusa, con com'è andata (target, stop, ancora aperto). Include **oro, titoli e cripto**.
- **Statistiche** in alto: segnali chiusi, target e stop, percentuale di vinte, R totale e curva.
- **Filtri:** strumento (oro, titoli, cripto), time frame, setup, direzione, target ed esito. Cambiano elenco e numeri. **Togli i filtri** li azzera.
- **Dove sbagli:** confronta le categorie dalla peggiore alla migliore (strumento, simbolo, livello, time frame, setup, direzione, target, ora, giorno) con percentuale di target e stop, R medio e R totale. Ogni categoria con meno di 8 segnali chiusi è segnata "pochi casi": col caso pesa molto, quindi cerca i punti deboli che restano tali quando i segnali aumentano.
- **Azzera da adesso:** ricomincia il conteggio da questo momento sul tuo telefono; i segnali precedenti non si mostrano né si contano ma non sono cancellati. **Ripristina tutto** li rimette.
- **Livello dei titoli:** "netto" è il criterio più severo (almeno 20 casi e R medio oltre 2 volte l'incertezza), "possibile" è quello normale.
- Gli ultimi segnali stanno anche in un **archivio sul telefono** (120 giorni): restano anche se il server si azzera.

### Scanner titoli e cripto
- Il riquadro non si vede più: lo scanner controlla circa 108 strumenti (100 grandi titoli USA e 8 cripto) su giornaliero (a fine giornata e al mattino) e su 1 ora (ogni ora durante la Borsa USA), buy e short e i suoi segnali favorevoli stanno nei **Segnali automatici**, con le notifiche.

### Report dei segnali favorevoli
- Il tuo diario personale: solo i segnali che hai visto tu con l'app aperta su questo telefono, seguiti fino a target, stop o fine finestra. È diverso dai Segnali automatici, che sono l'elenco completo del server.

### Quadro di mercato
- Dollaro, rendimento USA a 10 anni, S&P 500 e VIX: variazione di oggi, se è insolita e la **correlazione con l'oro** negli ultimi 30 giorni (da -1 a +1). Segnala quando dollaro e oro si muovono nello stesso verso, che di solito non succede.

### Sessioni dell'oro
- Quanto si muove in media l'oro in ogni ora del giorno (ora italiana) e per sessione (Asia, Londra, New York), su circa due anni di dati. Barre alte = più movimento. Non dice in che direzione andrà.

### Come ha reagito l'oro alla Fed
- Cosa ha fatto l'oro nell'ora e nelle due ore dopo ogni decisione della Fed (17 decisioni misurate). Il messaggio utile è la **dimensione** del movimento (in media oltre 3 volte il normale), non la direzione.

## 8. Operazioni

A cosa serve: caricare le tue operazioni di MetaTrader 5, vedere come stai andando e capire dove sbagli. I dati restano **solo sul telefono**.

### Le mie operazioni (MetaTrader 5)
- **Caricare:** incolla il testo dell'email di Vantage (Monthly o Daily Statement, tabella Deals) con **Incolla testo → Importa**, oppure **Carica file** (CSV o HTML). Le operazioni già salvate non si duplicano.
- Il contatore dice quante operazioni sono salvate su questo telefono.
- **Periodi dal 9 all'8 del mese dopo**, per data di chiusura. I dati provvisori ricavati da video vengono sostituiti dall'estratto mensile.
- Le statistiche mostrano: risultato netto, **dopo tasse (26%)**, operazioni, percentuale di vinte, profit factor, media di vincita e perdita, migliore e peggiore, durata, commissioni e swap.

### Analisi dei risultati
- Numeri chiave, periodo per periodo (lotto medio, perdita media, calo massimo), BUY contro SHORT e osservazioni sulle abitudini: payoff, quanto pesano i tre trade migliori, lotti e rischio, operazioni al giorno, giorno e ora più deboli. Segnala sempre i limiti dei dati.

### Serie, giorni e dimensioni
- Calo massimo, serie di vittorie e sconfitte, giorni in positivo, giorno migliore e peggiore, risultati per dimensione delle operazioni.

### Andamento del periodo, Risultato per giorno
- Curva del periodo e barre per giorno. Tocca per i dettagli.

### BUY e SHORT
- Confronto tra le due direzioni.

### Per giorno della settimana, Per ora di apertura
- Dove guadagni e dove perdi per giorno e per ora (orario del tuo broker).

### Prospettive (stime, non previsioni)
- Stime mensili, trimestrali, annuali, a 3 e 5 anni o a scelta (da 1 a 40) rimescolando i tuoi giorni di mercato. Mostra anche lo scenario prudente senza vantaggio. È un esercizio, non un obiettivo.

### Depositi e prelievi
- Segna a mano i soldi che metti e tiri fuori: il capitale si ricalcola da solo e lo usano il consiglio sul lotto e le prospettive. Il credito o bonus del broker non è capitale.

### Che lotto usare
- Un consiglio di dimensione in base al capitale, al calo massimo che accetti e a come operi davvero (una singola operazione non oltre il 5% del capitale). È solo analisi: non è un ordine.

### Confronto tra periodi
- Barre e righe dei periodi, con risultato e dopo tasse.

### Ultime operazioni
- Le ultime 60 operazioni, con **Esporta CSV** e **Cancella dati**.

### E se… (cosa sarebbe cambiato)
- Rifà la tua storia con una regola diversa: escludere un giorno o un'ora, massimo di operazioni al giorno, fermarti dopo una perdita nel giorno, lotto fisso. Mostra la differenza. Serve a capire **dove** si perde, non a prevedere: con pochi dati un giorno "cattivo" può essere solo caso.

### Tu contro la regola dell'app
- Confronta le tue operazioni con tutti i breakout della regola base nello stesso periodo (30m, 1h o 4h; target 2R, 3R o 4R). Indicativo: la regola ha uno stop, tu no.

### Mappa giorno × ora
- Una griglia: ogni casella è un giorno e un'ora di apertura, verde = guadagno, rosso = perdita. Tocca una casella per i dettagli.

### Riepilogo fiscale
- Risultato per anno e per periodo, tasse stimate al 26% e quanto tenere da parte. **Scarica il riepilogo (CSV)**. È una stima: non è consulenza fiscale.

## 9. Notifiche sul telefono

A cosa serve: ricevere avvisi **anche con l'app chiusa**, grazie all'app gratuita **ntfy**.

### Cosa arriva
- **Promemoria delle 7:00:** "Buongiorno - carica l'email di Vantage".
- **30 minuti prima di una notizia rossa** (USD, EUR, GBP).
- **Segnali favorevoli** su oro, titoli e cripto, con target 2R, 3R o 4R. Se nello stesso giro ce ne sono più di uno, arrivano **in un solo messaggio**.
- **Esiti** dei segnali già avvisati (target, stop).
- **Prova:** quando premi "Manda una notifica di prova".

### Come si collega
- Installa **ntfy** sul telefono, iscriviti al canale segreto (lo stesso nome impostato sul server) e consenti le notifiche dell'app, senza risparmio batteria.

### Se non arriva nulla
1. In Avvisi apri "Notifiche sul telefono": se un invio risulta **inviato**, il problema è sul telefono (canale giusto? notifiche e batteria dell'app ntfy).
2. Se risulta **non inviato**, leggi il motivo. Con "429 troppe richieste" il servizio gratuito ha esaurito la quota: serve il token ntfy (vedi la guida di gestione).
3. Premi **Manda una notifica di prova**.

### Limiti
- Il servizio gratuito ferma a 250 messaggi al giorno per indirizzo; l'app ne manda al massimo 150 al giorno (i promemoria passano sempre).

## 10. Dati e privacy

- **Sul telefono:** operazioni, depositi e prelievi, diario personale, archivio dei segnali, impostazioni, stato dei riquadri chiusi. Non vanno mai sul server.
- **Sul server:** solo segnali e registri pubblici (nessun dato personale). Il server non ha password: non metterci mai dati sensibili.
- **Chiavi:** non scriverle mai in file o in chat; si mettono solo come variabili sul server.

## 11. Problemi comuni

- **Non vedo le novità:** chiudi e riapri l'app due volte.
- **"Carico…" che non finisce in un riquadro:** il server o i dati non hanno risposto; aggiorna con il pulsante tondo e riprova dopo qualche minuto.
- **Il prezzo dell'oro dice "feed ritardato":** il feed live non ha risposto; i dati di Yahoo hanno circa 10 minuti di ritardo. Si risolve da solo.
- **Non arrivano notifiche:** vedi la sezione "Notifiche sul telefono" qui sopra.
- **I numeri di "Dove sbagli" sembrano strani:** guarda "pochi casi"; sotto 8 segnali chiusi per categoria non c'è abbastanza dato.
- **Ho perso le operazioni:** i dati stanno sul telefono; se cancelli i dati del browser spariscono. Esporta il CSV ogni tanto.

## 12. Glossario

- **ATR:** escursione media di una barra; serve a misurare la volatilità.
- **Breakout:** una barra che chiude oltre il massimo o il minimo delle ultime N barre.
- **Calo massimo (drawdown):** la discesa più grande dal punto più alto del conto.
- **Payoff:** vincita media divisa per perdita media.
- **Profit factor:** somma delle vincite divisa per somma delle perdite; sopra 1 si guadagna.
- **R:** multiplo del rischio; 1R è la distanza dallo stop.
- **RSI:** indicatore di forza del movimento; sopra 70 il prezzo è molto salito, sotto 30 molto sceso.
- **Swap:** costo o ricavo per tenere aperta una posizione di notte.
- **Time frame:** durata di ogni candela (5 minuti, 1 ora, 1 giorno...).
