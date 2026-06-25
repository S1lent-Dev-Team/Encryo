// i18n.js — leichtgewichtige Zwei-Sprachen-Unterstützung (DE/EN) ohne Dependency.
//
//   const { t, lang, setLang } = useI18n();
//   t("nav.upload")                      -> "Upload"
//   t("upload.progress", { done, total }) -> Platzhalter {done}/{total} ersetzt
//
// Die Sprache wird in localStorage gemerkt; Default ist Browser-Sprache (en→en,
// sonst de). Nur UI-Text — Schlüssel/Secrets sind davon nie betroffen.

import { createContext, createElement, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "encryo:lang";

const translations = {
  de: {
    // — Navigation / Header / Footer —
    "nav.upload": "Upload",
    "nav.myLinks": "Meine Links",
    "nav.signIn": "Anmelden",
    "header.signOut": "Abmelden",
    "footer.tagline":
      "Ende-zu-Ende verschlüsselt im Browser · Zero-Knowledge Datei-Hosting",
    "footer.credit": "Ein Projekt von",
    "lang.label": "Sprache",
    "theme.toggle": "Design wechseln",

    // — Gemeinsam —
    "common.signInOrRegister": "Anmelden oder registrieren",
    "common.file.one": "Datei",
    "common.file.other": "Dateien",
    "common.link.one": "Link",
    "common.link.other": "Links",
    "common.never": "Nie",

    // — Upload —
    "upload.zkBadge": "Zero-Knowledge · Ende-zu-Ende",
    "upload.titleBefore": "Teile Dateien, die ",
    "upload.titleHighlight": "niemand",
    "upload.titleAfter": " mitliest",
    "upload.subtitle":
      "Verschlüsselung passiert in deinem Browser. Der Link trägt den Schlüssel — der Server speichert nur Ciphertext.",
    "upload.removeFile": "Entfernen",
    "upload.moveUp": "Nach oben",
    "upload.moveDown": "Nach unten",
    "upload.renameAria": "Dateiname",
    "upload.withoutAccount": " (ohne Account)",
    "upload.autoExpiry": "Ablauf auto. 24 Std",
    "upload.overLimit": "über dem Limit",
    "upload.needAccount.pre": "Dateien über {hard} brauchen einen Account. ",
    "upload.needAccount.post":
      " — mit Account bis {free} dauerhaft, größere mit 24-Std-Ablauf.",
    "upload.password.label": "Passwortschutz",
    "upload.password.hint": "Schlüssel wird aus dem Passwort abgeleitet (PBKDF2)",
    "upload.password.placeholder": "Passwort festlegen…",
    "upload.password.generate": "Generieren",
    "upload.password.generateTitle": "Starkes Passwort generieren",
    "upload.embed.label": "Passwort in den Link einbetten",
    "upload.embed.hint":
      "Empfänger sieht die Vorschau sofort (kein separater Kanal nötig)",
    "upload.oneTime.label": "One-Time-View",
    "upload.oneTime.hint": "Link wird nach dem ersten Öffnen unbrauchbar",
    "upload.preview.label": "Öffentliche Vorschau (Embed-Bild)",
    "upload.preview.hint": "Erzeugt ein Embed-Bild für Discord/Slack & Co.",
    "upload.preview.warnPre": "Achtung: Das Vorschaubild wird ",
    "upload.preview.warnBold": "unverschlüsselt & öffentlich",
    "upload.preview.warnPost":
      " gespeichert (sichtbar für jeden mit dem Link, auch ohne Schlüssel). Nur aktivieren, wenn das Bild nicht vertraulich ist.",
    "upload.maxViews.label": "Aufrufe begrenzen",
    "upload.maxViews.hint": "Link nach N Öffnungen automatisch sperren",
    "upload.maxViews.placeholder": "z.B. 5",
    "upload.recover.label": "Wiederherstellung aktivieren",
    "upload.recover.hint":
      "Verschlüsselte Kopie des Schlüssels in deinem Account – wiederherstellbar mit deinem Account-Passwort",
    "upload.recover.confirmLabel": "Account-Passwort bestätigen",
    "upload.recover.accountPwPlaceholder": "Dein Account-Passwort…",
    "upload.recover.confirmHint":
      "Nach einem Reload liegt der Recovery-Schlüssel nicht mehr im Speicher – einmal bestätigen genügt.",
    "upload.expiry.label": "Ablaufdatum",
    "upload.expiry.hintForced": "Über {free} fest auf {hours} Std",
    "upload.expiry.hint": "Ohne: Link bleibt gültig, bis du ihn sperrst/löschst",
    "upload.expiry.forcedNote":
      "Dieser Upload liegt über dem Freikontingent ({free}) — der Ablauf wird automatisch auf {hours} Std gesetzt.",
    "upload.expiry.1h": "1 Std",
    "upload.expiry.24h": "24 Std",
    "upload.expiry.7d": "7 Tage",
    "upload.expiry.custom": "Datum",
    "upload.progress": "Verschlüssele {done}/{total} Dateien…",
    "upload.submit": "Verschlüsseln & Link erstellen",
    "upload.submitBusy": "Verschlüsseln…",
    "upload.shortcutHint": "Tipp: ⌘/Strg + Enter verschlüsselt",
    "upload.err.noFile": "Bitte zuerst eine Datei auswählen.",
    "upload.err.pwShort": "Passwort muss mindestens 4 Zeichen haben.",
    "upload.err.needAccount": "Dateien über {hard} brauchen einen Account.",
    "upload.err.tooBig": "Maximal {hard} pro Link.",
    "upload.err.maxViews": "Max. Aufrufe muss eine positive Zahl sein.",
    "upload.err.expiryPast": "Ablaufzeit muss in der Zukunft liegen.",
    "upload.err.recoverConfirm":
      "Bitte Account-Passwort bestätigen, um Recovery zu aktivieren.",
    "upload.err.recoverPw": "Account-Passwort falsch — Recovery nicht aktiviert.",
    "upload.err.encrypt": "Verschlüsselung fehlgeschlagen: {msg}",

    // — Erfolg —
    "success.title": "Link erstellt",
    "success.shareLink": "Share-Link",
    "success.copy": "Kopieren",
    "success.copied": "Link kopiert",
    "success.shareTitle": "Teilen",
    "badge.password": "Passwort",
    "badge.keyInLink": "Schlüssel im Link",
    "badge.passwordSeparate": "Passwort separat",
    "badge.oneTime": "One-Time",
    "badge.maxViews": "max. {n}×",
    "badge.recoverable": "wiederherstellbar",
    "badge.publicPreview": "öffentl. Vorschau",
    "success.secretNote.separate":
      "Der Schlüssel steckt nicht im Link — teile das Passwort über einen separaten Kanal.",
    "success.secretNote.inLink":
      "Der Schlüssel steckt hinter # im Link und wird nie an den Server gesendet. Wer den Link hat, kann entschlüsseln.",
    "success.shareHeading": "So erscheint der Link beim Teilen",
    "success.noPreviewNote":
      "Ohne aktivierte öffentliche Vorschau zeigt der Embed nur Metadaten (Größe, Schutz) — kein Bild.",
    "success.showQr": "QR-Code anzeigen",
    "success.hideQr": "QR-Code ausblenden",
    "success.newLink": "Neuer Link",
    "success.recipientView": "Empfänger-Ansicht",

    // — QR —
    "qr.savePng": "PNG speichern",
    "qr.unavailable": "QR-Code nicht verfügbar",

    // — Dropzone —
    "dropzone.title": "Dateien hierher ziehen oder auswählen",
    "dropzone.hint":
      "Mehrere Dateien werden als Collection unter einem Link gebündelt",

    // — Passwort-Stärke / -Feld —
    "pw.strength.label": "Passwortstärke: {level}",
    "pw.strength.0": "sehr schwach",
    "pw.strength.1": "schwach",
    "pw.strength.2": "okay",
    "pw.strength.3": "stark",
    "pw.strength.4": "sehr stark",
    "pw.show": "Passwort anzeigen",
    "pw.hide": "Passwort verbergen",

    // — Empfänger-Ansicht —
    "view.decrypting": "Entschlüssele…",
    "view.waiting": "verschlüsselt · wartet auf dich",
    "view.oneTimeWarn.pre": "Dieser Link kann ",
    "view.oneTimeWarn.bold": "nur einmal",
    "view.oneTimeWarn.post":
      " geöffnet werden. Danach ist der Inhalt unwiderruflich gesperrt — auch für dich.",
    "view.needKey":
      "Diesem Link fehlt der Schlüssel hinter # — er wurde vermutlich unvollständig kopiert. Füge ihn hier ein:",
    "view.keyPlaceholder": "Schlüssel oder ganzen Link einfügen…",
    "view.pwPlaceholder": "Passwort eingeben…",
    "view.open.oneTime": "Einmalig öffnen",
    "view.open.normal": "Entschlüsseln & anzeigen",
    "view.open.busy": "Entschlüsseln…",
    "view.recover.label": "Account-Passwort zum Wiederherstellen",
    "view.recover.button": "Wiederherstellen",
    "view.recover.cta": "Mit Account-Passwort wiederherstellen",
    "view.browserNote": "Entschlüsselung passiert in deinem Browser",
    "view.err.needPw": "Bitte Passwort eingeben.",
    "view.err.keyMissing":
      "Diesem Link fehlt der Schlüssel (#…). Füge ihn unten ein – oder stelle ihn als Eigentümer wieder her.",
    "view.err.keyBuild": "Schlüssel konnte nicht aufgebaut werden.",
    "view.err.wrongPw": "Falsches Passwort.",
    "view.err.keyMismatch":
      "Schlüssel passt nicht — Link beschädigt oder Schlüssel falsch eingefügt.",
    "view.err.decrypt": "Entschlüsselung fehlgeschlagen.",
    "view.err.loginFirst": "Bitte zuerst einloggen, um wiederherzustellen.",
    "view.err.ownerOnly": "Nur der Eigentümer dieses Links kann ihn wiederherstellen.",
    "view.err.noVault": "Für diesen Link gibt es keinen Recovery-Vault.",
    "view.err.recoverFail":
      "Falsches Account-Passwort oder Wiederherstellung fehlgeschlagen.",

    // — Geöffnet —
    "opened.title": "Entschlüsselt",
    "opened.subtitle": "{count} {fileWord} · {n}. Öffnung",
    "opened.zip": "Alle als ZIP",
    "opened.zipDone": "ZIP heruntergeladen",
    "opened.burned": "jetzt verbrannt",
    "opened.oneTimeNote":
      "Das war die einzige Öffnung — lade dir jetzt, was du brauchst. Beim Neuladen ist der Link weg.",
    "opened.download": "Download",
    "opened.shareOwn": "Eigene Datei verschlüsselt teilen →",
    "opened.decryptProgress": "Entschlüssele {done}/{total} …",
    "preview.loading": "Lade Vorschau…",
    "preview.copyText": "Text kopieren",
    "preview.copied": "Text kopiert",
    "preview.zoom": "Vergrößern",

    // — Weg / gesperrt —
    "gone.NOT_FOUND.t": "Link nicht gefunden",
    "gone.NOT_FOUND.d": "Dieser Link existiert nicht (mehr).",
    "gone.EXPIRED.t": "Link abgelaufen",
    "gone.EXPIRED.d": "Die Gültigkeitsdauer ist überschritten.",
    "gone.BURNED.t": "Bereits geöffnet",
    "gone.BURNED.d": "Dieser Link wurde schon (oft genug) abgerufen und ist gesperrt.",
    "gone.REVOKED.t": "Vom Eigentümer gesperrt",
    "gone.REVOKED.d": "Der Eigentümer hat diesen Link manuell gesperrt.",
    "gone.createOwn": "Eigenen Link erstellen",

    // — Login —
    "login.signIn": "Anmelden",
    "login.createAccount": "Account erstellen",
    "login.subtitle": "Verwalte deine Links an einem Ort.",
    "login.username": "Username",
    "login.usernamePlaceholder": "z.B. cellum",
    "login.password": "Passwort",
    "login.noAccount": "Noch kein Account?",
    "login.haveAccount": "Schon registriert?",
    "login.toRegister": "Registrieren",
    "login.toLogin": "Anmelden",
    "login.failed": "Fehlgeschlagen.",
    "login.footer":
      "Passwörter werden serverseitig als scrypt-Hash gespeichert · httpOnly-Session.",

    // — Dashboard —
    "dash.loading": "Lade…",
    "dash.loadingLinks": "Lade Links…",
    "dash.signInTitle": "Melde dich an",
    "dash.signInBody":
      "Mit einem Account bündelst du alle deine Links inkl. View-Counter und Zugriffs-History – geräteübergreifend.",
    "dash.myLinks": "Meine Links",
    "dash.new": "Neu",
    "dash.empty.title": "Noch keine Links",
    "dash.empty.body":
      "Hier erscheinen deine Links inkl. View-Counter und Zugriffs-History.",
    "dash.empty.cta": "Ersten Link erstellen",
    "dash.search": "Nach ID oder Dateiname suchen…",
    "dash.filter.all": "Alle",
    "dash.filter.active": "Aktiv",
    "dash.filter.inactive": "Inaktiv",
    "dash.sort.new": "Neueste",
    "dash.sort.old": "Älteste",
    "dash.sort.views": "Meiste Aufrufe",
    "dash.noMatches": "Keine Treffer für diese Filter.",
    "dash.footer":
      "Der Server speichert den Schlüssel nie im Klartext. Ohne aktivierte Wiederherstellung ist der vollständige Share-Link nur direkt nach dem Erstellen verfügbar.",
    "dash.storage": "{used} Speicher",
    "dash.confirmDelete":
      "Diesen Link unwiderruflich LÖSCHEN?\n\nLöschen entfernt Link, Datei-Inhalt und Zugriffs-History vollständig — er verschwindet aus dieser Übersicht.\n\n(Sperren behält Link & Statistik, blockiert aber jeden Zugriff.)",
    "dash.confirmRevoke":
      "Diesen Link sofort & unwiderruflich SPERREN?\n\nDer Link wird für alle Empfänger blockiert, bleibt aber mit seiner Statistik in deiner Übersicht (zum Löschen den Papierkorb nutzen).",
    "dash.toast.deleted": "Link gelöscht",
    "dash.toast.revoked": "Link gesperrt",
    "dash.select": "Link auswählen",
    "dash.bulk.selectAll": "Alle auswählen",
    "dash.bulk.selected": "{n} ausgewählt",
    "dash.bulk.revoke": "Sperren",
    "dash.bulk.delete": "Löschen",
    "dash.bulk.clear": "Auswahl aufheben",
    "dash.confirmBulkRevoke": "{n} Link(s) sofort & unwiderruflich sperren? Sie bleiben mit Statistik in der Übersicht.",
    "dash.confirmBulkDelete": "{n} Link(s) unwiderruflich löschen? Inhalt, Link & Statistik werden vollständig entfernt.",
    "dash.toast.bulkRevoked": "{n} Link(s) gesperrt",
    "dash.toast.bulkDeleted": "{n} Link(s) gelöscht",

    // — Kontoeinstellungen —
    "acct.title": "Kontoeinstellungen",
    "acct.intro": "Account-Passwort ändern. ",
    "acct.introRecover":
      "{n} wiederherstellbare(r) Link(s) werden dabei automatisch neu verschlüsselt — der Server sieht dabei keinen Klartext.",
    "acct.current": "Aktuelles Passwort",
    "acct.new": "Neues Passwort",
    "acct.submit": "Passwort ändern",
    "acct.err.newShort": "Neues Passwort braucht mind. 6 Zeichen.",
    "acct.err.currentWrong": "Aktuelles Passwort ist falsch.",
    "acct.changed": "Passwort geändert.",
    "acct.changedVaults": " {n} Vault(s) neu verschlüsselt.",
    "acct.err.changeFail": "Änderung fehlgeschlagen.",

    // — API-Tokens —
    "tokens.title": "API-Tokens",
    "tokens.intro": "Für programmatische Uploads (CLI/Skripte). Ein Token hat vollen Account-Zugriff — behandle es wie ein Passwort.",
    "tokens.labelPlaceholder": "Bezeichnung (z.B. Laptop-CLI)",
    "tokens.create": "Token erstellen",
    "tokens.createdOnce": "Token erstellt — wird nur jetzt angezeigt:",
    "tokens.copied": "Token kopiert",
    "tokens.none": "Noch keine Tokens.",
    "tokens.lastUsed": "zuletzt {rel}",
    "tokens.neverUsed": "ungenutzt",
    "tokens.revoke": "Widerrufen",
    "tokens.confirmRevoke": "Token widerrufen? Skripte mit diesem Token funktionieren danach nicht mehr.",
    "tokens.toast.revoked": "Token widerrufen",

    // — Link-Zeile —
    "row.status.revoked": "gesperrt",
    "row.status.burned": "verbrannt",
    "row.status.expired": "abgelaufen",
    "row.status.active": "aktiv",
    "row.views": "Aufrufe",
    "row.created": "erstellt {date}",
    "row.expires": "Ablauf {rel}",
    "row.accessHistory": "Zugriffs-History",
    "row.notOpened": "Noch nicht geöffnet.",
    "row.recover.label": "Account-Passwort, um den Voll-Link zu rekonstruieren",
    "row.recover.placeholder": "Account-Passwort…",
    "row.recover.wrongPw": "Falsches Account-Passwort.",
    "row.recover.loginAgain": "Bitte neu einloggen.",
    "row.fullLink": "Vollständiger Share-Link (inkl. Schlüssel)",
    "row.copy": "Kopieren",
    "row.actions": "Aktionen",
    "row.btn.link": "Link",
    "row.btn.full": "Voll",
    "row.btn.open": "Öffnen",
    "row.btn.share": "Teilen",
    "row.btn.revoke": "Sperren",
    "row.btn.delete": "Löschen",
    "row.toast.copyBase": "Basis-Link kopiert",
    "row.toast.copyFull": "Voll-Link kopiert",
    "row.title.copyBase": "Basis-Link kopieren (ohne Schlüssel)",
    "row.title.full": "Vollständigen Link per Account-Passwort wiederherstellen",
    "row.title.open": "Empfänger-Ansicht in neuem Tab öffnen",
    "row.title.share": "Link teilen",
    "row.title.revoke":
      "Sperren (Kill-Switch): blockiert Zugriffe, behält den Link samt Statistik",
    "row.title.delete": "Endgültig löschen: entfernt Link, Inhalt & Statistik komplett",

    // — Share-Vorschau —
    "share.title.one": "1 verschlüsselte Datei · Encryo",
    "share.title.other": "{n} verschlüsselte Dateien · Encryo",
    "share.body": "Im Browser verschlüsselt — zum Entschlüsseln öffnen.",
    "share.passwordProtected": "passwortgeschützt",
    "share.oneTime": "One-Time",
    "share.expiresAt": "läuft ab {rel}",
  },

  en: {
    // — Navigation / Header / Footer —
    "nav.upload": "Upload",
    "nav.myLinks": "My links",
    "nav.signIn": "Sign in",
    "header.signOut": "Sign out",
    "footer.tagline":
      "End-to-end encrypted in your browser · zero-knowledge file hosting",
    "footer.credit": "A project by",
    "lang.label": "Language",
    "theme.toggle": "Toggle theme",

    // — Common —
    "common.signInOrRegister": "Sign in or register",
    "common.file.one": "file",
    "common.file.other": "files",
    "common.link.one": "link",
    "common.link.other": "links",
    "common.never": "Never",

    // — Upload —
    "upload.zkBadge": "Zero-knowledge · end-to-end",
    "upload.titleBefore": "Share files ",
    "upload.titleHighlight": "no one",
    "upload.titleAfter": " can read",
    "upload.subtitle":
      "Encryption happens in your browser. The link carries the key — the server only stores ciphertext.",
    "upload.removeFile": "Remove",
    "upload.moveUp": "Move up",
    "upload.moveDown": "Move down",
    "upload.renameAria": "File name",
    "upload.withoutAccount": " (no account)",
    "upload.autoExpiry": "auto-expires in 24 h",
    "upload.overLimit": "over the limit",
    "upload.needAccount.pre": "Files over {hard} require an account. ",
    "upload.needAccount.post":
      " — with an account up to {free} permanently, larger ones with a 24-hour expiry.",
    "upload.password.label": "Password protection",
    "upload.password.hint": "The key is derived from the password (PBKDF2)",
    "upload.password.placeholder": "Set a password…",
    "upload.password.generate": "Generate",
    "upload.password.generateTitle": "Generate a strong password",
    "upload.embed.label": "Embed password in the link",
    "upload.embed.hint":
      "Recipient sees the preview instantly (no separate channel needed)",
    "upload.oneTime.label": "One-time view",
    "upload.oneTime.hint": "Link becomes unusable after the first open",
    "upload.preview.label": "Public preview (embed image)",
    "upload.preview.hint": "Creates an embed image for Discord/Slack & co.",
    "upload.preview.warnPre": "Heads up: the preview image is stored ",
    "upload.preview.warnBold": "unencrypted & publicly",
    "upload.preview.warnPost":
      " (visible to anyone with the link, even without the key). Only enable it if the image isn't confidential.",
    "upload.maxViews.label": "Limit views",
    "upload.maxViews.hint": "Auto-lock the link after N opens",
    "upload.maxViews.placeholder": "e.g. 5",
    "upload.recover.label": "Enable recovery",
    "upload.recover.hint":
      "Encrypted copy of the key in your account – recoverable with your account password",
    "upload.recover.confirmLabel": "Confirm account password",
    "upload.recover.accountPwPlaceholder": "Your account password…",
    "upload.recover.confirmHint":
      "After a reload the recovery key is no longer in memory – confirming once is enough.",
    "upload.expiry.label": "Expiry",
    "upload.expiry.hintForced": "Over {free} fixed to {hours} h",
    "upload.expiry.hint": "Off: the link stays valid until you lock/delete it",
    "upload.expiry.forcedNote":
      "This upload is over the free allowance ({free}) — the expiry is automatically set to {hours} h.",
    "upload.expiry.1h": "1 h",
    "upload.expiry.24h": "24 h",
    "upload.expiry.7d": "7 days",
    "upload.expiry.custom": "Date",
    "upload.progress": "Encrypting {done}/{total} files…",
    "upload.submit": "Encrypt & create link",
    "upload.submitBusy": "Encrypting…",
    "upload.shortcutHint": "Tip: ⌘/Ctrl + Enter encrypts",
    "upload.err.noFile": "Please select a file first.",
    "upload.err.pwShort": "Password must be at least 4 characters.",
    "upload.err.needAccount": "Files over {hard} require an account.",
    "upload.err.tooBig": "Up to {hard} per link.",
    "upload.err.maxViews": "Max views must be a positive number.",
    "upload.err.expiryPast": "Expiry must be in the future.",
    "upload.err.recoverConfirm":
      "Please confirm your account password to enable recovery.",
    "upload.err.recoverPw": "Wrong account password — recovery not enabled.",
    "upload.err.encrypt": "Encryption failed: {msg}",

    // — Success —
    "success.title": "Link created",
    "success.shareLink": "Share link",
    "success.copy": "Copy",
    "success.copied": "Link copied",
    "success.shareTitle": "Share",
    "badge.password": "Password",
    "badge.keyInLink": "Key in link",
    "badge.passwordSeparate": "Password separate",
    "badge.oneTime": "One-time",
    "badge.maxViews": "max {n}×",
    "badge.recoverable": "recoverable",
    "badge.publicPreview": "public preview",
    "success.secretNote.separate":
      "The key isn't in the link — share the password through a separate channel.",
    "success.secretNote.inLink":
      "The key sits after the # in the link and is never sent to the server. Anyone with the link can decrypt.",
    "success.shareHeading": "How the link looks when shared",
    "success.noPreviewNote":
      "Without public preview enabled, the embed only shows metadata (size, protection) — no image.",
    "success.showQr": "Show QR code",
    "success.hideQr": "Hide QR code",
    "success.newLink": "New link",
    "success.recipientView": "Recipient view",

    // — QR —
    "qr.savePng": "Save PNG",
    "qr.unavailable": "QR code unavailable",

    // — Dropzone —
    "dropzone.title": "Drag files here or browse",
    "dropzone.hint": "Multiple files are bundled as a collection under one link",

    // — Password strength / field —
    "pw.strength.label": "Password strength: {level}",
    "pw.strength.0": "very weak",
    "pw.strength.1": "weak",
    "pw.strength.2": "okay",
    "pw.strength.3": "strong",
    "pw.strength.4": "very strong",
    "pw.show": "Show password",
    "pw.hide": "Hide password",

    // — Recipient view —
    "view.decrypting": "Decrypting…",
    "view.waiting": "encrypted · waiting for you",
    "view.oneTimeWarn.pre": "This link can be opened ",
    "view.oneTimeWarn.bold": "only once",
    "view.oneTimeWarn.post":
      ". After that the content is locked irreversibly — even for you.",
    "view.needKey":
      "This link is missing the key after the # — it was probably copied incompletely. Paste it here:",
    "view.keyPlaceholder": "Paste the key or the whole link…",
    "view.pwPlaceholder": "Enter password…",
    "view.open.oneTime": "Open once",
    "view.open.normal": "Decrypt & show",
    "view.open.busy": "Decrypting…",
    "view.recover.label": "Account password to recover",
    "view.recover.button": "Recover",
    "view.recover.cta": "Recover with account password",
    "view.browserNote": "Decryption happens in your browser",
    "view.err.needPw": "Please enter the password.",
    "view.err.keyMissing":
      "This link is missing the key (#…). Paste it below – or recover it as the owner.",
    "view.err.keyBuild": "Couldn't build the key.",
    "view.err.wrongPw": "Wrong password.",
    "view.err.keyMismatch":
      "Key doesn't match — link damaged or key pasted incorrectly.",
    "view.err.decrypt": "Decryption failed.",
    "view.err.loginFirst": "Please sign in first to recover.",
    "view.err.ownerOnly": "Only the owner of this link can recover it.",
    "view.err.noVault": "There's no recovery vault for this link.",
    "view.err.recoverFail": "Wrong account password or recovery failed.",

    // — Opened —
    "opened.title": "Decrypted",
    "opened.subtitle": "{count} {fileWord} · open #{n}",
    "opened.zip": "All as ZIP",
    "opened.zipDone": "ZIP downloaded",
    "opened.burned": "now burned",
    "opened.oneTimeNote":
      "That was the only open — download what you need now. On reload the link is gone.",
    "opened.download": "Download",
    "opened.shareOwn": "Share your own file encrypted →",
    "opened.decryptProgress": "Decrypting {done}/{total} …",
    "preview.loading": "Loading preview…",
    "preview.copyText": "Copy text",
    "preview.copied": "Text copied",
    "preview.zoom": "Enlarge",

    // — Gone / locked —
    "gone.NOT_FOUND.t": "Link not found",
    "gone.NOT_FOUND.d": "This link doesn't exist (anymore).",
    "gone.EXPIRED.t": "Link expired",
    "gone.EXPIRED.d": "The validity period has passed.",
    "gone.BURNED.t": "Already opened",
    "gone.BURNED.d": "This link has been accessed (enough times) and is locked.",
    "gone.REVOKED.t": "Locked by the owner",
    "gone.REVOKED.d": "The owner locked this link manually.",
    "gone.createOwn": "Create your own link",

    // — Login —
    "login.signIn": "Sign in",
    "login.createAccount": "Create account",
    "login.subtitle": "Manage all your links in one place.",
    "login.username": "Username",
    "login.usernamePlaceholder": "e.g. cellum",
    "login.password": "Password",
    "login.noAccount": "No account yet?",
    "login.haveAccount": "Already registered?",
    "login.toRegister": "Register",
    "login.toLogin": "Sign in",
    "login.failed": "Failed.",
    "login.footer":
      "Passwords are stored server-side as a scrypt hash · httpOnly session.",

    // — Dashboard —
    "dash.loading": "Loading…",
    "dash.loadingLinks": "Loading links…",
    "dash.signInTitle": "Sign in",
    "dash.signInBody":
      "With an account you bundle all your links incl. view counter and access history – across devices.",
    "dash.myLinks": "My links",
    "dash.new": "New",
    "dash.empty.title": "No links yet",
    "dash.empty.body": "Your links show up here incl. view counter and access history.",
    "dash.empty.cta": "Create your first link",
    "dash.search": "Search by ID or filename…",
    "dash.filter.all": "All",
    "dash.filter.active": "Active",
    "dash.filter.inactive": "Inactive",
    "dash.sort.new": "Newest",
    "dash.sort.old": "Oldest",
    "dash.sort.views": "Most views",
    "dash.noMatches": "No matches for these filters.",
    "dash.footer":
      "The server never stores the key in plaintext. Without recovery enabled, the full share link is only available right after creation.",
    "dash.storage": "{used} stored",
    "dash.confirmDelete":
      "Permanently DELETE this link?\n\nDeleting removes the link, file content and access history completely — it disappears from this overview.\n\n(Locking keeps the link & stats but blocks all access.)",
    "dash.confirmRevoke":
      "LOCK this link immediately and irreversibly?\n\nThe link is blocked for all recipients but stays with its stats in your overview (use the trash to delete it).",
    "dash.toast.deleted": "Link deleted",
    "dash.toast.revoked": "Link locked",
    "dash.select": "Select link",
    "dash.bulk.selectAll": "Select all",
    "dash.bulk.selected": "{n} selected",
    "dash.bulk.revoke": "Lock",
    "dash.bulk.delete": "Delete",
    "dash.bulk.clear": "Clear selection",
    "dash.confirmBulkRevoke": "Lock {n} link(s) immediately and irreversibly? They stay with their stats in the overview.",
    "dash.confirmBulkDelete": "Permanently delete {n} link(s)? Content, link & stats are removed entirely.",
    "dash.toast.bulkRevoked": "{n} link(s) locked",
    "dash.toast.bulkDeleted": "{n} link(s) deleted",

    // — Account settings —
    "acct.title": "Account settings",
    "acct.intro": "Change account password. ",
    "acct.introRecover":
      "{n} recoverable link(s) will be re-encrypted automatically — the server sees no plaintext.",
    "acct.current": "Current password",
    "acct.new": "New password",
    "acct.submit": "Change password",
    "acct.err.newShort": "New password needs at least 6 characters.",
    "acct.err.currentWrong": "Current password is wrong.",
    "acct.changed": "Password changed.",
    "acct.changedVaults": " {n} vault(s) re-encrypted.",
    "acct.err.changeFail": "Change failed.",

    // — API tokens —
    "tokens.title": "API tokens",
    "tokens.intro": "For programmatic uploads (CLI/scripts). A token has full account access — treat it like a password.",
    "tokens.labelPlaceholder": "Label (e.g. laptop CLI)",
    "tokens.create": "Create token",
    "tokens.createdOnce": "Token created — shown only now:",
    "tokens.copied": "Token copied",
    "tokens.none": "No tokens yet.",
    "tokens.lastUsed": "last used {rel}",
    "tokens.neverUsed": "unused",
    "tokens.revoke": "Revoke",
    "tokens.confirmRevoke": "Revoke token? Scripts using this token will stop working.",
    "tokens.toast.revoked": "Token revoked",

    // — Link row —
    "row.status.revoked": "locked",
    "row.status.burned": "burned",
    "row.status.expired": "expired",
    "row.status.active": "active",
    "row.views": "views",
    "row.created": "created {date}",
    "row.expires": "expires {rel}",
    "row.accessHistory": "Access history",
    "row.notOpened": "Not opened yet.",
    "row.recover.label": "Account password to reconstruct the full link",
    "row.recover.placeholder": "Account password…",
    "row.recover.wrongPw": "Wrong account password.",
    "row.recover.loginAgain": "Please sign in again.",
    "row.fullLink": "Full share link (incl. key)",
    "row.copy": "Copy",
    "row.actions": "Actions",
    "row.btn.link": "Link",
    "row.btn.full": "Full",
    "row.btn.open": "Open",
    "row.btn.share": "Share",
    "row.btn.revoke": "Lock",
    "row.btn.delete": "Delete",
    "row.toast.copyBase": "Base link copied",
    "row.toast.copyFull": "Full link copied",
    "row.title.copyBase": "Copy base link (without key)",
    "row.title.full": "Reconstruct the full link with your account password",
    "row.title.open": "Open recipient view in a new tab",
    "row.title.share": "Share link",
    "row.title.revoke": "Lock (kill switch): blocks access, keeps the link and its stats",
    "row.title.delete": "Delete permanently: removes link, content & stats entirely",

    // — Share preview —
    "share.title.one": "1 encrypted file · Encryo",
    "share.title.other": "{n} encrypted files · Encryo",
    "share.body": "Encrypted in the browser — open to decrypt.",
    "share.passwordProtected": "password-protected",
    "share.oneTime": "one-time",
    "share.expiresAt": "expires {rel}",
  },
};

function detectLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "de" || saved === "en") return saved;
  } catch {
    /* localStorage nicht verfügbar */
  }
  if (
    typeof navigator !== "undefined" &&
    navigator.language &&
    navigator.language.toLowerCase().startsWith("en")
  )
    return "en";
  return "de";
}

const I18nContext = createContext({ lang: "de", setLang: () => {}, t: (k) => k });

export const useI18n = () => useContext(I18nContext);

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(detectLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  function setLang(next) {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignorieren */
    }
  }

  function t(key, vars) {
    const dict = translations[lang] || translations.de;
    let s = dict[key] ?? translations.de[key] ?? key;
    if (vars)
      for (const [k, v] of Object.entries(vars))
        s = s.split(`{${k}}`).join(String(v));
    return s;
  }

  return createElement(I18nContext.Provider, { value: { lang, setLang, t } }, children);
}
