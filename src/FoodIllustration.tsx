const kinds = [
  { match: /coffee|cafe|tea/, col: 2, row: 1, label: 'coffee' },
  { match: /bakery|cake|dessert|pastry|donut/, col: 1, row: 1, label: 'bakery treat' },
  { match: /pizza|italian/, col: 2, row: 0, label: 'pizza' },
  { match: /sushi|japanese/, col: 1, row: 0, label: 'sushi' },
  { match: /taco|mexican/, col: 3, row: 0, label: 'taco' },
  { match: /burger|fast.?food|american/, col: 0, row: 1, label: 'burger' },
  { match: /noodle|ramen|thai|chinese|korean|vietnamese|asian/, col: 0, row: 0, label: 'noodles' },
];

export default function FoodIllustration({ cuisine }: { cuisine: string }) {
  const match = kinds.find(kind => kind.match.test(cuisine.toLowerCase()));
  const col = match?.col ?? 3;
  const row = match?.row ?? 1;
  const label = match?.label ?? 'a meal';
  return <span
    className="food-illustration"
    role="img"
    aria-label={`Cute illustration of ${label}`}
    style={{
      backgroundImage: `url("${import.meta.env.BASE_URL}food-sprite.png")`,
      backgroundPosition: `${col * 100 / 3}% ${row * 100}%`,
    }}
  />;
}
