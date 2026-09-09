import { formatPrice, INTL_LOCALES } from "@/lib/format";
import { DEFAULT_LOCALE, type Locale } from "@/lib/showcase";

/**
 * The booking page's words, in a language other than the one it was built in.
 *
 * ---------------------------------------------------------------------------
 * **Every lookup carries its own fallback, and that is the whole safety
 * design.** This product is Hebrew and its booking page takes real money's
 * worth of real bookings; a Spanish showcase must not be able to break it. So a
 * component asks for `t("service.title", "בחרו שירות")` — the second argument
 * is the literal that is on the page today, and it is what renders whenever the
 * locale is Hebrew *or* the key is missing. A typo in a key, a translation
 * nobody wrote, a locale nobody added: all of them come out as the Hebrew that
 * was already there.
 *
 * That is why this is a flat map of strings rather than a typed schema. A
 * schema would catch a missing key at build time and it would also make every
 * missing key a build failure, which is the wrong trade for a file whose whole
 * job is to degrade quietly.
 *
 * **Keys are `area.thing`**, named for what the string *is* rather than what it
 * says, so a reworded Hebrew literal does not orphan its translation.
 *
 * **This does not translate the shop's data.** Service names, staff names and
 * the description are the owner's own words in the database; see
 * `showcaseContent` at the bottom for the narrow, display-only exception that
 * makes the demo shop legible to a Spanish reader.
 * ---------------------------------------------------------------------------
 */

type Dictionary = Record<string, string>;

const ES: Dictionary = {
  // Stepper.
  "step.service": "Elige servicio",
  "step.datetime": "Fecha",
  "step.confirm": "Resumen",
  "step.aria": "Pasos de la reserva",
  "step.progress": "Paso",
  "step.current": "— paso actual",

  // Shared connectives. `common.of` joins a number to a total, which is how
  // "3 מתוך 5" is written on this page in four different places.
  "common.of": "de",
  "common.day": "",
  "common.at": "a las",

  // Services.
  "service.title": "Elige un servicio",
  "service.available": "servicios disponibles",
  "service.none": "Este negocio aún no ha configurado servicios.",

  // Gallery.
  "gallery.heading": "Nuestro trabajo",
  "gallery.enlarge": "Ampliar imagen",
  "gallery.close": "Cerrar",
  "gallery.prev": "Anterior",
  "gallery.next": "Siguiente",

  // Reviews.
  "reviews.title": "Lo que dicen los clientes",
  "reviews.count": "opiniones",
  "reviews.rating": "Valoración",

  // Day and time.
  "datetime.title": "Elige fecha y hora",
  "datetime.pickDay": "Elegir día",
  "datetime.today": "Hoy",
  "datetime.tomorrow": "Mañana",
  "slot.morning": "Mañana",
  "slot.noon": "Mediodía",
  "slot.evening": "Tarde",
  "slot.pickTime": "Elegir hora",
  "slot.loading": "Buscando horas libres…",
  "slot.emptyTitle": "No hay horas libres este día",
  "slot.emptyBody":
    "Prueba con otro día en la barra de fechas — casi siempre queda hueco en uno o dos días.",
  "slot.waitlist": "¿Sin hueco? Apúntate a la lista de espera",

  // Opening hours.
  "hours.title": "Horario",
  "hours.close": "Cerrar",
  "hours.closed": "Cerrado",
  "hours.today": "Hoy",
  "day.sun": "Domingo",
  "day.mon": "Lunes",
  "day.tue": "Martes",
  "day.wed": "Miércoles",
  "day.thu": "Jueves",
  "day.fri": "Viernes",
  "day.sat": "Sábado",

  // Flow chrome.
  "flow.pickStaff": "Elegir profesional",
  "flow.pickService": "Elegir servicio",
  "flow.pickWhen": "Elegir fecha",
  "flow.details": "Datos",
  "flow.back": "Atrás",
  "flow.backTo": "Volver a",

  // Details form.
  "details.title": "Tus datos",
  "details.when": "Fecha",
  "details.priceDuration": "Precio y duración",
  "details.name": "Nombre completo",
  "details.namePlaceholder": "Nombre y apellido",
  "details.phone": "Teléfono móvil",
  "details.email": "Correo (confirmación y recordatorio)",
  "details.notes": "Comentarios (opcional)",
  "details.notesPlaceholder": "¿Algo que debamos saber?",
  "details.honeypot": "No rellenes este campo",
  "details.submit": "Confirmar reserva",
  "details.submitting": "Reservando…",
  "details.marketing":
    "Quiero recibir novedades y ofertas del negocio por WhatsApp. Puedes darte de baja cuando quieras.",
  "details.consent":
    "Al reservar aceptas recibir mensajes relacionados con esta cita.",
  "details.consentAction": "Confirmar reserva",

  // Who with — only reachable in a shop with more than one chair.
  "staff.title": "¿Con quién a las",
  "staff.available": "profesionales disponibles a esa hora.",
  "only.title": "A las {time} solo está libre {name}",
  "only.body":
    "Puedes continuar con {name}, o elegir otra hora en la que quizá haya más profesionales libres.",
  "only.continue": "Continuar con",
  "only.otherTime": "Elegir otra hora",

  // Confirmation.
  "confirm.pendingTitle": "Hemos recibido tu solicitud",
  "confirm.pendingBody":
    "te confirmará la cita en breve. Te avisaremos en cuanto lo haga.",
  "confirm.doneTitle": "¡Tu cita está confirmada!",
  "confirm.doneBody": "Cita en",
  "confirm.service": "Servicio",
  "confirm.price": "Precio",
  "confirm.name": "Nombre",
  "confirm.phone": "Teléfono",
  "confirm.addToCalendar": "Añadir al calendario",
  "confirm.manageAwaiting": "Ver o cancelar la solicitud",
  "confirm.manage": "Ver o cancelar la cita",
  "confirm.noteAwaiting":
    "Guarda este enlace — desde ahí puedes seguir el estado de la solicitud o cancelarla.",
  "confirm.note":
    "Guarda este enlace — desde ahí puedes ver la cita o cancelarla.",
  "confirm.another": "Reservar otra cita",

  // Waitlist.
  "waitlist.title": "Lista de espera",
  "waitlist.body":
    "te avisará en cuanto se libere una hora que te encaje.",
  "waitlist.close": "Cerrar",
  "waitlist.doneTitle": "Ya estás apuntado",
  // Split around the shop's name, which sits in the middle of the sentence in
  // both languages but on different sides of the verb.
  "waitlist.doneBodyBefore": "En cuanto se libere una hora que te encaje,",
  "waitlist.doneBodyAfter": "te enviará un mensaje con un enlace para cogerla.",
  "waitlist.name": "Nombre completo",
  "waitlist.phone": "Teléfono",
  "waitlist.service": "Servicio",
  "waitlist.anyService": "Cualquier servicio",
  "waitlist.days": "Días que te van bien",
  "waitlist.daysHint": "(opcional — si no eliges ninguno, valen todos)",
  "waitlist.window": "Franja horaria",
  "window.morning": "Mañana",
  "window.afternoon": "Mediodía",
  "window.evening": "Tarde",
  "window.any": "Cualquier hora",
  "waitlist.notes": "Nota (opcional)",
  "waitlist.submit": "Apuntarme a la lista",

  // A client's own appointments, reached from the button at the foot of the
  // booking page.
  "my.title": "Mis citas",
  // Trailing spaces, for the reason given above the cookie banner's strings:
  // the Hebrew these replace ends in a glued prefix ("...ל", "...ב").
  "my.back": "Volver a ",
  "my.intro":
    "Introduce el teléfono con el que reservaste y te mostraremos tus citas en ",
  "my.phone": "Número de teléfono",
  "my.search": "Buscar",
  "my.emptyTitle": "No encontramos citas con ese número",
  "my.emptyBody":
    "Puede que reservaras con otro número. Puedes pedir una cita nueva en la página de reservas.",
  "my.book": "Reservar cita",
  "my.upcoming": "Próximas citas",
  "my.past": "Historial",
  "my.service": "Servicio",
  "my.staff": "Profesional",
  "my.cancel": "Cancelar cita",
  "my.cancelWindow":
    "No se puede cancelar con menos de {hours} h de antelación. Contacta con el negocio.",

  // Appointment states, as the client sees them.
  "status.confirmed": "Confirmada",
  "status.pending": "Pendiente de confirmar",
  "status.cancelled": "Cancelada",
  "status.completed": "Completada",
  "status.no_show": "No asistió",
  "status.pending_deposit": "Pendiente de pago",

  // Server-side answers. These come back from a Server Action, which resolves
  // the language from the slug it was called with.
  "error.badRequest": "Solicitud no válida",
  "error.badPhone": "Número de móvil no válido (por ejemplo: 050-1234567)",
  "error.noBusiness": "No encontramos el negocio",
  "error.lookup": "No se pudieron cargar las citas. Inténtalo de nuevo.",

  // The page itself.
  "page.myAppointments": "Ver mis citas",
  "page.poweredBy": "Con la tecnología de",
  "page.metaTitle": "reserva online",
  "page.metaDescription":
    "Reserva online en {name}. Elige servicio, día y hora — sin llamadas y sin registrarte.",

  // Cookie banner.
  //
  // The trailing spaces are load-bearing and are not a typo. Hebrew glues its
  // "the"/"and" onto the following word — "ל" + "מדיניות הפרטיות" is one word
  // with no gap — so the markup puts no space before the link. Spanish needs
  // one, and a string is the only place to put it: JSX strips whitespace from
  // literal text children but preserves it inside an expression's value.
  "cookies.body":
    "Usamos cookies para mejorar tu experiencia. Al pulsar «Aceptar» aceptas nuestra ",
  "cookies.and": "y la ",
  "cookies.terms": "Condiciones de uso",
  "cookies.privacy": "Política de privacidad",
  "cookies.accept": "Aceptar",
  "cookies.aria": "Aviso de cookies",

  // Implicit-consent line under the submit button.
  // Trailing spaces, for the reason given above the cookie banner's strings.
  "consent.before": "Al pulsar",
  "consent.middle": ", aceptas las ",
  "consent.and": "y la ",
  "consent.terms": "Condiciones de uso",
  "consent.privacy": "Política de privacidad",
};

const DICTIONARIES: Partial<Record<Locale, Dictionary>> = { es: ES };

/**
 * One string, or the Hebrew that is already on the page.
 *
 * `fallback` is not a nicety — it is the live product. Anything this function
 * cannot answer renders exactly what rendered before this file existed.
 */
export function translate(
  locale: Locale,
  key: string,
  fallback: string,
): string {
  if (locale === DEFAULT_LOCALE) return fallback;
  return DICTIONARIES[locale]?.[key] ?? fallback;
}

/**
 * The demo shop's *own* words, for the showcase address only.
 *
 * ---------------------------------------------------------------------------
 * **A deliberate exception, and a narrow one.** Everything above is the
 * product's chrome and translating it is uncontroversial. This is a tenant's
 * data — the name they chose, the services they sell — and rewriting that for
 * a real shop would be the software putting words in their mouth.
 *
 * It applies to one slug, at render time, and changes nothing in the database.
 * The justification is the purpose: a Spanish visitor looking at "תספורת גבר"
 * learns nothing about the product, so a showcase that translates the buttons
 * and not the services is not a showcase. Keyed by the exact Hebrew string, so
 * a service the owner renames simply stops matching and shows through in
 * Hebrew — visibly wrong on the demo page, and harmless everywhere else.
 * ---------------------------------------------------------------------------
 */
const SHOWCASE_CONTENT: Record<string, string> = {
  // The shop.
  "מספרת בלאק": "Barbería Black",
  "מספרה לגברים בלב תל אביב. תספורות, עיצוב זקן וטיפוח.":
    "Barbería de caballeros en el centro de Tel Aviv. Cortes, barba y cuidado.",
  "דיזנגוף 100, תל אביב": "Dizengoff 100, Tel Aviv",

  // The chair.
  "ניר בלאק": "Nir Black",
  "ספר בכיר": "Barbero sénior",

  // The menu, names and the sentence under each one.
  "תספורת גבר": "Corte de caballero",
  "תספורת מלאה כולל חפיפה וסידור.": "Corte completo con lavado y peinado.",
  "תספורת ילד": "Corte infantil",
  "תספורת לילדים עד גיל 12.": "Corte para niños hasta 12 años.",
  "עיצוב זקן": "Arreglo de barba",
  "עיצוב וקיצור זקן עם תער.": "Perfilado y recorte de barba a navaja.",
  "תספורת + זקן": "Corte + barba",
  "תספורת מלאה ועיצוב זקן באותו תור.":
    "Corte completo y arreglo de barba en la misma cita.",
  צבע: "Color",
  "צביעת שיער או זקן, כולל שטיפה.":
    "Coloración de pelo o barba, lavado incluido.",
};

/**
 * A tenant's own string as the showcase should render it.
 *
 * Only ever consulted for an alias address, and only ever falls back to the
 * original — so this cannot alter what a real client sees on a real page.
 */
export function showcaseContent(locale: Locale, value: string): string {
  if (locale === DEFAULT_LOCALE) return value;
  return SHOWCASE_CONTENT[value.trim()] ?? value;
}

/**
 * The demo shop's prices, in the currency the showcase is being read in.
 *
 * ---------------------------------------------------------------------------
 * **This is a stricter exception than `showcaseContent`, because a price is not
 * a word.** A service name that shows through in Hebrew is untranslated; a
 * price that shows through in the wrong currency is *wrong*, and this page has
 * a working book button under it. Rendering "$70" for a ₪70 haircut would
 * overstate it by roughly 3.7×, so the amount has to be converted and not just
 * relabelled.
 *
 * **A table rather than a rate, for two reasons.** A stored rate ages silently
 * — it is right on the day it is written and quietly wrong forever after, with
 * nothing on the page to say so. And an exact conversion lands on ₪70 → $18.90,
 * which is not a number any barbershop has ever posted on a wall. These are the
 * ILS prices converted at **≈0.27 USD/ILS (September 2026)** and then rounded
 * to a price a shop would actually charge.
 *
 * **Keyed on the name *and* the amount, and the amount is the guard.** Matching
 * the name alone would keep converting after the owner reprices — ₪75 rendered
 * as the $19 that used to be ₪70, a stale number with no way to notice it. With
 * the amount in the key a reprice simply misses, and the page falls back to
 * showing ILS: loud, visible on the demo, and harmless on every real page.
 * That also makes this fail in step with `showcaseContent`, since a renamed
 * service drops out of both at once.
 *
 * **Why not price alone:** ₪70 is one of the most common prices in Israel, and
 * a future alias pointed at a real shop would silently re-denominate their
 * menu. The name narrows that to a shop with this exact service at this exact
 * price — and adding an alias is already an edit to `ALIASES`, made by somebody
 * who has to look at this file anyway.
 * ---------------------------------------------------------------------------
 */
const SHOWCASE_PRICES: Record<string, { ils: number; usd: number }> = {
  "תספורת גבר": { ils: 7000, usd: 1900 },
  "תספורת ילד": { ils: 6000, usd: 1600 },
  "עיצוב זקן": { ils: 3000, usd: 800 },
  "תספורת + זקן": { ils: 9000, usd: 2400 },
  צבע: { ils: 14000, usd: 3800 },
};

/**
 * What a price should read as at a showcase address.
 *
 * Returns the amount unchanged for Hebrew, for a currency this does not
 * convert, for a service it does not know, and for one whose price has moved.
 * Like everything else in this file, it can change a rendering and cannot
 * remove one.
 */
export function showcasePrice(
  locale: Locale,
  serviceName: string,
  priceCents: number,
  currency: string,
): { priceCents: number; currency: string } {
  const unchanged = { priceCents, currency };

  if (locale === DEFAULT_LOCALE) return unchanged;
  // Only the currency the demo is priced in. A tenant already charging in USD
  // is showing a real price and must not be "converted" a second time.
  if (currency !== "ILS") return unchanged;

  const entry = SHOWCASE_PRICES[serviceName.trim()];
  if (!entry || entry.ils !== priceCents) return unchanged;

  return { priceCents: entry.usd, currency: "USD" };
}

/**
 * A price as the booking page should print it, in whichever language it is
 * being read.
 *
 * The lookup and the formatting are one call because there is exactly one
 * correct way to render a price on this page, and five call sites that each
 * had a chance to get it wrong separately — one of them was already passing a
 * hard-coded `"ILS"`.
 */
export function formatShowcasePrice(
  locale: Locale,
  serviceName: string,
  priceCents: number,
  currency: string,
): string {
  const shown = showcasePrice(locale, serviceName, priceCents, currency);
  return formatPrice(shown.priceCents, shown.currency, INTL_LOCALES[locale]);
}
