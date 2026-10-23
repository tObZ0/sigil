// Renders the small-size logo mark to src/app/icon.svg, so the favicon matches
// the header. Run after changing the mark: npm run icon
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { LogoMark } from "../src/components/logo";

const svg = renderToStaticMarkup(<LogoMark variant="sigil" size={64} />)
  .replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ')
  .replace(/ style="[^"]*"/, "")
  .replace(/ aria-hidden="true"/, "");
writeFileSync("src/app/icon.svg", svg);
console.log(`wrote src/app/icon.svg (${svg.length} bytes)`);
