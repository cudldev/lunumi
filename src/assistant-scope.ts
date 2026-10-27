const topicPattern = /(?<![\p{L}\p{N}])(restaurant|restaurants|menu|menus|lunch|dinner|breakfast|brunch|food|dish|dishes|meal|meals|eat|eating|cuisine|ingredient|ingredients|allergen|allergens|allergy|allergies|dietary|vegan|vegetarian|gluten|lactose|reservation|reservations|book a table|nearby|near me|recommend|where can i|where to eat|find a place|around here|ravintola|ravintolat|ruoka|ruokalista|ruokalistat|lounas|päivällinen|illallinen|aamiainen|annos|annokset|ainesosa|ainesosat|allergeeni|allergeenit|ruokavalio|vegaani|kasvis|gluteen|varaus|varata pöytä|lähellä|suosittele|missä|restaurang|restauranger|meny|lunch|middag|frukost|mat|rätt|rätter|ingredienser|allergen|allergi|vegansk|vegetarisk|gluten|boka bord|i närheten|hitta restaurang|rekommendera|réservation|restaurant|menu|déjeuner|dîner|petit-déjeuner|plat|plats|ingrédient|allergène|allergie|végétalien|végétarien|sans gluten|proche|où manger|recommander)(?![\p{L}\p{N}])/iu;
const overridePattern = /\b(ignore|disregard|forget|override|reveal|show|print|repeat|bypass|disable|replace)\b.{0,70}\b(instructions?|system prompt|rules?|persona|previous messages?|hidden prompt|safety)\b|\b(ohita|unohda|paljasta|näytä|toista|korvaa|ignorera|glöm|avslöja|visa|upprepa|ersätt|oublie|révèle|montre|répète|remplace)\b.{0,70}\b(ohjeet|ohjeita|järjestelmäkehote|säännöt|persoona|instruktioner|systemprompt|regler|instructions?|consignes?|prompt système|règles?|persona)\b|\b(act as|pretend to be|you are now|switch to|become|jailbreak|do anything now|general assistant|chatgpt|openai|ole nyt|toimi kuin|esitä että|du är nu|låt som|agis comme|fais semblant|sois maintenant)\b/i;
const unrelatedTaskPattern = /\b(write code|programming|debug (?:my |this )?code|homework|essay|poem|fiction|story|stock price|politics|solve (?:this )?equation|medical diagnosis|generate an image|kirjoita koodia|ohjelmoi|skriv kod|programmera|écris du code|programmer)\b/i;

const refusals = {
  en: "I'm Lunumi, your restaurant and menu assistant. I can help compare nearby restaurants, read their menus, and find source-backed food details.",
  fi: 'Olen Lunumi, ravintola- ja ruokalista-avustajasi. Voin auttaa vertailemaan lähistön ravintoloita, lukemaan ruokalistoja ja etsimään lähteisiin perustuvia ruokailutietoja.',
  sv: 'Jag är Lunumi, din restaurang- och menyassistent. Jag kan jämföra restauranger i närheten, läsa menyer och hitta källbelagd matinformation.',
  fr: 'Je suis Lunumi, votre assistant pour les restaurants et leurs menus. Je peux comparer les restaurants proches, lire leurs menus et trouver des informations culinaires avec leurs sources.',
} as const;

function refusalLanguage(text: string): keyof typeof refusals {
  if (/\b(ravintola|ruoka|ruokalista|lounas|päivällinen|illallinen|olen|voin auttaa)\b/i.test(text)) return 'fi';
  if (/\b(restaurang|restauranger|meny|middag|frukost|jag är|kan jämföra)\b/i.test(text)) return 'sv';
  if (/\b(réservation|déjeuner|dîner|restaurant|menu|je suis|je peux)\b/i.test(text)) return 'fr';
  return 'en';
}

export function isLunumiRequest(text: string, restaurantNames: string[], recentUserText = ''): boolean {
  if (overridePattern.test(text) || unrelatedTaskPattern.test(text)) return false;
  if (topicPattern.test(text)) return true;
  const folded = text.toLocaleLowerCase();
  if (restaurantNames.some(name => name.trim().length > 2 && folded.includes(name.toLocaleLowerCase()))) return true;
  const isShortFollowUp = text.trim().split(/\s+/).length <= 8;
  return isShortFollowUp && topicPattern.test(recentUserText);
}

export function lunumiScopeReply(text: string): string {
  return refusals[refusalLanguage(text)];
}
