import { CLOSE_BONUS, CLOSE_FROM_HAND_BONUS, JOKER_PENALTY, NOT_MELDED_PENALTY } from "@/lib/remi";

export function Rules({ open = false }: { open?: boolean }) {
  return (
    <details className="text-sm text-zinc-600 dark:text-zinc-400" open={open}>
      <summary className="cursor-pointer font-semibold">Reguli</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>106 piese: 1–13 în 4 culori (roșu, galben, albastru, negru), câte două din fiecare, plus 2 jokeri (★).</li>
        <li>2–4 jucători. Fiecare primește 14 piese. Cel care începe are 15 și doar aruncă o piesă.</li>
        <li>
          La tura ta: <b>tragi</b> o piesă din pachet sau iei <b>ultima piesă aruncată</b>. Pe cea luată de jos trebuie
          s-o pui pe masă în aceeași tură. Apoi faci formații și <b>arunci</b> o piesă ca să închei tura.
        </li>
        <li>
          Formații: <b>serie</b> (același număr, 3–4 culori diferite) sau <b>scară</b> (aceeași culoare, minim 3 numere
          consecutive). 1 poate fi la început (1-2-3) sau după 13 (12-13-1), dar nu 13-1-2. Jokerul ține locul oricărei piese.
        </li>
        <li>
          <b>Etalarea</b> (prima coborâre pe masă) trebuie să aibă cel puțin atâtea puncte cât a ales camera (piesa valorează
          cât numărul ei, 1 de după 13 valorează 14, jokerul cât piesa pe care o ține).
        </li>
        <li>
          După etalare poți adăuga piese la orice formație de pe masă și poți lua un joker dacă pui în locul lui piesa
          exactă. Jokerul luat trebuie pus pe masă în aceeași tură.
        </li>
        <li>Închizi când pui totul pe masă și arunci ultima piesă. Dacă se termină pachetul, runda se încheie fără câștigător.</li>
        <li>
          Puncte (cine are mai puține, câștigă): cel care închide primește {CLOSE_BONUS}. Ceilalți primesc suma pieselor
          rămase în mână (jokerul {JOKER_PENALTY}), iar cine nu s-a etalat primește {NOT_MELDED_PENALTY}. Dacă închizi „din
          mână”, adică totul într-o singură tură fără etalare înainte, primești {CLOSE_FROM_HAND_BONUS}, iar ceilalți iau
          dublu.
        </li>
      </ol>
    </details>
  );
}
