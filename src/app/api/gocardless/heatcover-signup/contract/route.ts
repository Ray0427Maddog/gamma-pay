import { NextRequest, NextResponse } from "next/server";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFFont,
  PDFPage,
} from "pdf-lib";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

type ContractRequest = {
  signupId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  address: string;
  city: string;
  postcode: string;
  paymentDay: number;
  plan?: HeatCoverPlan;
  excessFree?: boolean;
  neoU?: boolean;
  neoUInstallPence?: number;
};

type HeatCoverPlan = "v1" | "v2" | "v3" | "v4";

type ContractVariant = {
  plan: HeatCoverPlan;
  excessFree: boolean;
  displayName: string;
  description: string;
  monthlyPrice: number;
  excessAmount: number;
};

const CONTRACT_VARIANTS: Record<string, ContractVariant> = {
  v1: {
    plan: "v1",
    excessFree: false,
    displayName: "V1",
    description: "Gas Boiler, Heating, Plumbing & Drains",
    monthlyPrice: 27,
    excessAmount: 55,
  },

  v1ef: {
    plan: "v1",
    excessFree: true,
    displayName: "V1 EF",
    description: "Gas Boiler, Heating, Plumbing & Drains",
    monthlyPrice: 38,
    excessAmount: 0,
  },

  v2: {
  plan: "v2",
  excessFree: false,
  displayName: "V2",
  description: "Gas Boiler & Central Heating",
  monthlyPrice: 18,
  excessAmount: 55,
},

v2ef: {
  plan: "v2",
  excessFree: true,
  displayName: "V2 EF",
  description: "Gas Boiler & Central Heating",
  monthlyPrice: 29,
  excessAmount: 0,
},

v3: {
  plan: "v3",
  excessFree: false,
  displayName: "V3",
  description: "Service Only",
  monthlyPrice: 12,
  excessAmount: 0,
},

v4: {
  plan: "v4",
  excessFree: false,
  displayName: "V4",
  description: "Oil Boiler, Heating, Plumbing & Drains",
  monthlyPrice: 38,
  excessAmount: 55,
},

v4ef: {
  plan: "v4",
  excessFree: true,
  displayName: "V4 EF",
  description: "Oil Boiler, Heating, Plumbing & Drains",
  monthlyPrice: 49,
  excessAmount: 0,
},

};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;

const MARGIN_X = 48;
const TOP_Y = 790;
const BOTTOM_Y = 55;

const COMPANY_ADDRESS =
  "168 Galleywood Road, Great Baddow, Chelmsford, Essex, CM2 8YT";
const COMPANY_EMAIL = "info@gammaheating.co.uk";
const COMPANY_PHONE = "01245 979020";

function ordinal(day: number) {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;

  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/London",
  }).format(date);
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;

    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }

  if (current) lines.push(current);

  return lines;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ContractRequest;

    const {
  signupId,
  firstName,
  lastName,
  email,
  phone,
  address,
  city,
  postcode,
  paymentDay,
  plan = "v1",
  excessFree = false,
  neoU = false,
  neoUInstallPence = 0,
} = body;

    if (
      !signupId ||
      !firstName ||
      !lastName ||
      !email ||
      !address ||
      !city ||
      !postcode ||
      !paymentDay
    ) {
      return NextResponse.json(
        { success: false, error: "Missing contract details" },
        { status: 400 }
      );
    }

    if (
      !Number.isInteger(paymentDay) ||
      paymentDay < 1 ||
      paymentDay > 28
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid payment day" },
        { status: 400 }
      );
    }

    const variantKey = excessFree ? `${plan}ef` : plan;
const contract = CONTRACT_VARIANTS[variantKey];

if (!contract) {
  return NextResponse.json(
    {
      success: false,
      error: `Unsupported HeatCover+ contract: ${variantKey}`,
    },
    { status: 400 }
  );
}

    const pdfDoc = await PDFDocument.create();

    const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const logoPath = path.join(process.cwd(), "public", "Heatcover.png");
    const logoBytes = fs.readFileSync(logoPath);
    const heatcoverLogo = await pdfDoc.embedPng(logoBytes);

    let page: PDFPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y: number = TOP_Y;

    function addPage() {
  page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  y = TOP_Y;

  drawPageHeader();
}

function drawPageHeader() {
  const logoWidth = 150;
  const logoHeight =
    (heatcoverLogo.height / heatcoverLogo.width) * logoWidth;

  page.drawImage(heatcoverLogo, {
    x: MARGIN_X,
    y: y - logoHeight + 10,
    width: logoWidth,
    height: logoHeight,
  });

  y -= logoHeight + 15;
}

    function ensureSpace(required: number) {
      if (y - required < BOTTOM_Y) {
        addPage();
      }
    }

    function heading(text: string) {
      ensureSpace(28);

      y -= 5;

      page.drawText(text, {
        x: MARGIN_X,
        y,
        size: 12,
        font: bold,
      });

      y -= 19;
    }

    function paragraph(text: string, options?: { bold?: boolean }) {
      const font = options?.bold ? bold : regular;
      const size = 9.5;
      const lineHeight = 13;
      const maxWidth = PAGE_WIDTH - MARGIN_X * 2;

      const lines = wrapText(text, font, size, maxWidth);

      for (const line of lines) {
        ensureSpace(lineHeight);

        page.drawText(line, {
          x: MARGIN_X,
          y,
          size,
          font,
        });

        y -= lineHeight;
      }

      y -= 5;
    }

    function bullet(text: string) {
      const size = 9.5;
      const lineHeight = 13;
      const textWidth = PAGE_WIDTH - MARGIN_X * 2 - 14;
      const lines = wrapText(text, regular, size, textWidth);

      ensureSpace(lineHeight);

      page.drawText("•", {
        x: MARGIN_X,
        y,
        size,
        font: regular,
      });

      for (const line of lines) {
        ensureSpace(lineHeight);

        page.drawText(line, {
          x: MARGIN_X + 14,
          y,
          size,
          font: regular,
        });

        y -= lineHeight;
      }

      y -= 3;
    }

    function detail(label: string, value: string) {
      ensureSpace(16);

      page.drawText(label, {
        x: MARGIN_X,
        y,
        size: 9.5,
        font: bold,
      });

      page.drawText(value, {
        x: 165,
        y,
        size: 9.5,
        font: regular,
      });

      y -= 15;
    }

    drawPageHeader();

     page.drawText("HEATCOVER+ TELEPHONE AGREEMENT", {
      x: MARGIN_X,
      y,
      size: 16,
      font: bold,
    });

    y -= 23;

    page.drawText(
  `Plan ${contract.displayName} — ${contract.description}`,
  {
      x: MARGIN_X,
      y,
      size: 11,
      font: bold,
    });

    y -= 28;

    heading("Customer");

    detail("Name", `${firstName} ${lastName}`);
    detail("Address", address);
    detail("Town / City", city);
    detail("Postcode", postcode);
    detail("Email", email);

    if (phone) {
      detail("Telephone", phone);
    }

    y -= 5;

    heading("Agreement");

    detail("HeatCover+ plan", contract.displayName);
const withNeoU = contract.plan === "v4" && neoU === true;
detail(
  "Monthly payment",
  `£${(contract.monthlyPrice + (withNeoU ? 6 : 0)).toFixed(2)}`
);
if (withNeoU) {
  detail("Neo U tank monitor", "Included (+£6.00 per month)");
  if (neoUInstallPence > 0) {
    detail(
      "Neo U installation",
      `£${(neoUInstallPence / 100).toFixed(2)} one-off, with first payment`
    );
  }
}
if (contract.plan === "v3") {
  detail("Breakdown cover", "Not included");
} else {
  detail(
    "Breakdown excess",
    contract.excessAmount === 0
      ? "No excess"
      : `£${contract.excessAmount.toFixed(2)} per breakdown`
  );
}
    detail("Agreement date", formatDate(new Date()));
    detail("Payment date", `${ordinal(paymentDay)} of each month`);
    detail("Signup method", "Telephone");
    detail("HeatCover+ reference", signupId);

    y -= 8;

    if (withNeoU) {
      heading("Neo U Oil Tank Level Monitor");
      paragraph(
        "Your plan includes the GammaTherm Neo U oil tank level monitor for an additional £6.00 per month, included in the monthly payment above. Its terms are set out in the separate Neo U Equipment Agreement at the end of this document."
      );
    }

    heading("Gamma Heating");

    paragraph(COMPANY_ADDRESS);
    paragraph(`Email: ${COMPANY_EMAIL}`);
    paragraph(`Telephone: ${COMPANY_PHONE}`);

    heading("Terms and Conditions for your Care Plan");

    paragraph(
      "What we can look after: We currently have four care plan packages:"
    );

    bullet("Gas Boiler, System, Plumbing, Drains — HeatCover+ plan V1");
    bullet("Gas Boiler, Plumbing — HeatCover+ plan V2");
    bullet("Gas Boiler — HeatCover+ plan V3");
    bullet("Oil Boiler, System, Plumbing, Drains — HeatCover+ plan V4");

    paragraph(
      "Our promise: We aim to provide highest quality service to repair, maintain or replace your equipment included in your selected care plan. If you have any questions or concerns please do not hesitate to contact us on info@gammaheating.co.uk."
    );

    paragraph(
      "Cover agreement: All our agreements are monthly rolling plans and will commence 15 days following the date you first applied."
    );

    paragraph(
      "Every plan will need full inspection of your heating system, plumbing or electrical installation. There will be 30 days cooling-off period in which you will not be covered."
    );

    paragraph(
      "Renewals: For your convenience, your cover plan will renew automatically unless you notify us otherwise. We will notify you in writing prior to this and attach your new terms and conditions."
    );

    heading(
  `Terms And Conditions For Your HeatCover+ Plan ${contract.displayName}`
);

    if (contract.plan === "v1") {
  paragraph(
    `Plumbing care plan cost from just £${contract.monthlyPrice}/month which includes FREE system health check.`
  );
} else if (contract.plan === "v2") {
  paragraph(
    `Central heating care plan costs just from £${contract.monthlyPrice}/month which includes free boiler inspection and service.`
  );
} else if (contract.plan === "v3") {
  paragraph(
    `Boiler care plan cost from just £${contract.monthlyPrice}/month which includes FREE system health check.`
  );
} else if (contract.plan === "v4") {
  paragraph(
    `Plumbing care plan cost from just £${contract.monthlyPrice}/month which includes FREE system health check.`
  );
}

    paragraph(
      "Care plan is provided by us, your local and trusted company. All our engineers are fully trained, qualified and DBS checked."
    );

    paragraph(
      "Giving you a peace of mind and knowing your heating system is in best hands, the company who actually cares."
    );

    heading("Our Agreement Covers");

    const v1CoveredItems = [
      "Repairs to your hot water storage tank including valves and floats.",
      "Repairs in the event of breakdown of a single gas boiler within your home.",
      "Repairs or replacement of external heating controls including; room thermostat, programmer and pump where installed in accordance to manufacturers instructions.",
      "Parts and labour, your boiler has to be less than 18 years of age and must pass initial health inspection.",
      "Internal central heating pipework.",
      "Our cover plan includes FREE annual boiler service and system health check.",
      "Repairs to gas supply pipework between your gas meter and appropriate appliance. Where pipework needs replacing, we will install new pipework routes of our design.",
      "Removing sludge and scale from your boiler and heating system. If you haven’t got magnetic filter fitted, our engineer might offer one to install at additional cost.",
      "Replacing your gas or electric boiler, except under the circumstances set out in our terms and conditions.",
      "Replacing or repairing parts of your central heating system and controls that are specifically designed for piped underfloor heating.",
      "Vented or unvented hot water cylinders.",
      "Immersion heating elements and thermostats within the element.",
      "Hot and cold water pipes from mains stopcock inside your home leading to taps and garden taps (but not including stopcock itself).",
      "Unblocking of kitchen sink waste and basin waste, also unblocking of toilet waste and rainwater downpipes. This applies to pipes within the boundary of your property where you have sole responsibility for the pipes. This does not include any underground foul drainage or soak-away pipework.",
      "Washing machine and dishwasher hot and cold flexible pipes and isolating valves (installed to manufacturer’s instructions).",
      "Replacing of tap washers waste traps.",
      "Replacing of kitchen taps and basin taps where necessary (not including instant or stored boiling water taps).",
      "Replacement of showers (not including electric showers). Please note, this may not be like-for-like depending on the age of current unit as it may be obsolete or discontinued.",
      "Single gas or electric or oil central heating boiler (parts and labour).",
      "Pipework directly connected to gas or electric appliance (no more than 100mm).",
      "Flues, where complies with manufacturer’s instructions (up to 1 meter in length).",
      "PRV discharge pipework, where complies with manufacturer’s instructions.",
      "Condensate pipework, where complies with manufacturer’s instructions.",
      contract.excessFree
  ? "There is no excess to pay with V1 EF HomeCare plan."
  : "Each breakdown will incur £55 excess charge.",
    ];
    const v2CoveredItems = [
  "Repairs in the event of breakdown of a single gas boiler within your home.",
  "Repairs or replacement of external heating controls including; room thermostat, programmer and pump where installed in accordance to manufacturers instructions.",
  "Parts and labour, your boiler has to be less than 18 years of age and must pass initial health inspection.",
  "Internal central heating pipework.",
  "Our cover plan includes FREE annual boiler service and system health check.",
  "Repairs to gas supply pipework between your gas meter and appropriate appliance. Where pipework needs replacing, we will install new pipework routes of our design.",
  "Removing sludge and scale from your boiler and heating system. If you haven’t got magnetic filter fitted, our engineer might offer one to install at additional cost.",
  "Replacing your gas or electric boiler, except under the circumstances set out in our terms and conditions.",
  "Replacing or repairing parts of your central heating system and controls that are specifically designed for piped underfloor heating.",
  "Single gas or electric or oil central heating boiler (parts and labour).",
  "Pipework directly connected to gas or electric appliance (no more than 100mm).",
  "Flues, where complies with manufacturer’s instructions (up to 1 meter in length).",
  "PRV discharge pipework, where complies with manufacturer’s instructions.",
  "Condensate pipework, where complies with manufacturer’s instructions.",
  contract.excessFree
    ? "There is no excess to pay with V2 EF HomeCare plan."
    : "Each breakdown will incur £55 excess charge.",
];

const v3CoveredItems = [
  "Single gas or electric servicing.",
];

const v4CoveredItems = [
  "Repairs to your hot water storage tank including valves and floats.",
  "Vented or unvented hot water cylinders.",
  "Immersion heating elements and thermostats within the element.",
  "Hot and cold water pipes from mains stopcock inside your home leading to taps and garden taps (but not including stopcock itself).",
  "Unblocking of kitchen sink waste and basin waste, also unblocking of toilet waste and rainwater downpipes. This applies to pipes within the boundary of your property where you have sole responsibility for the pipes. This does not include any underground foul drainage or soak-away pipework.",
  "Washing machine and dishwasher hot and cold flexible pipes and isolating valves (installed to manufacturer's instructions).",
  "Replacing of tap washers and waste traps.",
  "Replacing of kitchen taps and basin taps where necessary (not including instant or stored boiling water taps).",
  "Replacement of showers (not including electric showers). Please note, this may not be like-for-like depending on the age of current unit as it may be obsolete or discontinued.",

  contract.excessFree
    ? "There is no excess to pay with V4 EF HomeCare plan."
    : "Each breakdown will incur £55 excess charge.",

  "Repairs in the event of breakdown of a single oil boiler within your home.",
  "Repairs or replacement of external heating controls including; room thermostat, programmer and pump where installed in accordance to manufacturers instructions.",
  "Parts and labour, your boiler has to be less than 12 years of age and must pass initial health inspection.",
  "Internal central heating pipework.",
  "Our cover plan includes FREE annual boiler service and system health check.",
  "Repairs to oil supply pipework between your oil tank and appropriate appliance. Where pipework needs replacing, we will install new pipework routes of our design.",
  "Removing sludge and scale from your boiler and heating system. If you haven't got magnetic filter fitted, our engineer might offer one to install at additional cost.",
  "Replacing your oil boiler, except under the circumstances set out in our terms and conditions.",
  "Replacing or repairing parts of your central heating system and controls that are specifically designed for piped underfloor heating.",
  "Single oil central heating boiler (parts and labour).",
  "Pipework directly connected to oil appliance (no more than 100mm).",
  "Flues, where complies with manufacturer's instructions (up to 1 meter in length).",
  "PRV discharge pipework, where complies with manufacturer's instructions.",
  "Condensate pipework, where complies with manufacturer's instructions.",
];

const coveredItems =
  contract.plan === "v2"
    ? v2CoveredItems
    : contract.plan === "v3"
    ? v3CoveredItems
    : contract.plan === "v4"
    ? v4CoveredItems
    : v1CoveredItems;

    for (const item of coveredItems) {
      bullet(item);
    }

    heading("General Conditions And Exclusions");

    const conditions = [
      [
        "Complaints",
        "We aim to do our best, but unfortunately, there may be times when things go wrong. If you have a complaint about any part of our service or our products, please contact us on info@gammaheating.co.uk. We will deal with your matter as soon as possible but if we can’t, we will inform you regularly.",
      ],
      [
  "Domestic Use",
  contract.plan === "v4"
    ? "GPHE care plans are only available for appliances used inside your home for domestic purposes only. These packages may benefit landlords and Landlords oil safety checks (CD12`s) can be provided at additional cost."
    : "GPHE care plans are only available for appliances used inside your home for domestic purposes only. These packages may benefit landlords and gas safety checks (CP12`s) can be provided at additional cost.",
],
      [
        "Price Changes",
        "Your prices will remain as agreed and will not change for duration of agreement (every 12 months your agreement is reviewed).",
      ],
      [
        "Internet Based Heating Controls",
        "We do not cover internet-based controls under any of our current care plans, however, most controls come with manufacturer’s warranty and if it’s within the manufacturer’s warranty we will replace them free of charge in the event of a failure.",
      ],
      [
        "Our Responsibilities",
        "We will meet our responsibilities under your agreement(s) within reasonable time unless it's impossible because of circumstances outside our control.",
      ],
      [
  "First Initial Inspection",
  contract.plan === "v4"
    ? "Before your agreement starts, we will need to carry out an initial inspection of your boiler and its controls, plumbing, oil pipework and electrical installation to make sure they are in good working order. Our engineers will issue an inspection certificate to show what they checked. We will carry out this inspection before your agreement(s) starts. If the initial inspection reveals a problem, we may: (1) Tell you what work is needed and what it will cost you for that work to be carried out. (2) Refuse agreement until the problems have been solved."
    : "Before your agreement starts, we will need to carry out an initial inspection of your boiler and its controls, plumbing, gas pipework and electrical installation to make sure they are in good working order. Our engineers will issue an inspection certificate to show what they checked. We will carry out this inspection before your agreement(s) starts. If the initial inspection reveals a problem, we may: (1) Tell you what work is needed and what it will cost you for that work to be carried out. (2) Refuse agreement until the problems have been solved.",
],
      [
        "Types Of Emergencies",
        "We at GPHE will determine the severity of the emergency which will determine the speed in which we will react. Please note, in cold months this may take a little longer. However, you are a priority as you are within our care plan(s).",
      ],
      [
        "Change of Ownership",
        "We will not carry out a first inspection, if we have already done so at the property within 12 months.",
      ],
      [
        "Annual Service",
        "We will inform you when your annual service is due and will carry it out same time each year where possible. This will depend on our workload and your preference for an appointment.",
      ],
      [
        "Gaining Access to Your Property and Arranging Appointments",
        "It’s your responsibility to allow us access to your property. If we cannot gain access to your property, we will arrange another appointment at suitable date for you and us. If we cannot gain access to the property on second visit or you do not arrange second visit your agreement will continue even though we have been unable to carry out the service and you may not be eligible for repairs. Third visit will be charged £100+VAT.",
      ],
      [
        "Magnetic Filters and Scale Reducers",
        "We will repair and maintain any magnetic filters and scale reducers on gas or electric appliance under our care plan. We will also clean magnetic filters as part of annual service. Unless it is deemed unpractical to access or it is clear that leak may occur.",
      ],
      [
        "Powerflush",
        "We use powerflush pumps to clean the system to remove sludge and corrosion deposits from your heating system. If we recommend you require any powerflush work done, we will charge you to undertake this work £35+VAT/radiator, boiler or cylinder. Once it is finished, there will be no charge in the future, for any powerflush work that may be needed, as long you keep continuous GHPE central heating care plan. When repair is needed due to sludge or corrosion deposits and we have not told you that you need powerflush. We will attempt to carry out the repair (excluding powerflush) and will do so at no extra cost. However, at that point we will advise that powerflush is required and until the powerflush has taken place (either done by us or test sample is sent for analysis at extra cost), we will not cover any ongoing sludge or hard water issues within the boiler or any components.",
      ],
    ] as const;

    for (const [title, text] of conditions) {
      paragraph(`${title}: ${text}`);
    }

    heading("Cancellation");

    paragraph("Your rights to cancel:", { bold: true });

    bullet(
      "You may cancel at any point, we do require you do so at least 3 working days prior your direct debit due date in writing to info@gammaheating.co.uk."
    );
    bullet(
      "We will stop next months direct debit payment. If you informed us after payment date, we will not refund the charge."
    );
    bullet("You may not cancel within your cooling off period.");

    paragraph("Our Cancellation Rights:", { bold: true });

    const cancellationRights = [
      "If we give you reasonable notice.",
      "If you have given false information.",
      "If you do not make agreed payment.",
      contract.plan === "v4"
  ? "For agreements concerning oil boilers, oil appliances, heating systems, plumbing or electrics, if we find something wrong at the initial inspection, or we have advised you that permanent repairs or improvements are needed to make sure your appliance or system works properly, and you do not follow our advice within reasonable period. This advice may include replacing your boiler, parts of heating system, fuse board (What constitutes a reasonable period will vary depending on the nature of the issue and period could be short in the case of, for example, safety issue)."
  : "For agreements concerning gas boilers, gas appliances, heating systems, plumbing or electrics, if we find something wrong at the initial inspection, or we have advised you that permanent repairs or improvements are needed to make sure your appliance or system works properly, and you do not follow our advice within reasonable period. This advice may include replacing your boiler, parts of heating system, fuse board (What constitutes a reasonable period will vary depending on the nature of the issue and period could be short in the case of, for example, safety issue).",
      "If we are not able to find parts to keep your appliance or system working in good, safe order.",
      "If circumstances arise (including Health & Safety issues) which makes it inappropriate for the contract to continue.",
    ];

    for (const item of cancellationRights) {
      bullet(item);
    }

    const remainingConditions = [
      [
        "Safety Advise",
        "We may advise you that permanent repairs or improvement are needed to make sure your appliance or system works safely and efficiently (for example, to comply with gas safety regulation, such as upgrading your ventilation to meet current standard). If you do not follow our advice, it may mean that we are unable to fulfil all of our obligations under your agreement. In this case, your agreement will continue unless you inform using writing, you would like to cancel the agreement.",
      ],
      [
        "Spare Parts",
        "If we do not carry the spare parts for you repair work needs on the day, we can get hold of them within next working day. In rare cases, parts may need to be ordered directly from manufacturers and will take longer.",
      ],
      [
        "Labour",
        "One of our highly trained engineers will usually carry out the work. In some cases we may have to authorize a suitably qualified contractor to carry out the work.",
      ],
      [
        "Approved Equipment",
        "We only undertake work on appliances, energy-management systems and plastic pipes which are on our approved list.",
      ],
      [
        "Third-Party Rights",
        "Nobody other than you will be able to benefit from this agreement, which cannot be passed to someone else without our consent.",
      ],
      [
        "Guarantees",
        "GHPE guarantees all parts and labour for 12 months from date of repair. Any guarantees do not affect your legal rights under the Sale of Goods Act 1979 and Supply of Goods Act 1982. You can get advice about your legal rights from a Citizen Advise Bureau or Trading Standards Department.",
      ],
      [
        "Appointment Times",
        "GHPE offers two appointment time slots; AM (8AM-12Noon) & PM (12Noon-6PM). With your request, we will contact you with an hour’s notice before the engineers arrival.",
      ],
      [
        "Payments",
        "We take payments via DIRECT DEBIT for all our care plans. Any repairs carried out will need to be paid in BACS, cash or credit/debit card immediately after work is carried out. In some cases, we do take 30%-60% deposit before work is carried (for example, boiler change or fuse board change).",
      ],
      [
        "Moving Home",
        "If you are moving home, please notify us as soon as possible about any change of address. Once we receive a new address details from you, we will automatically transfer your agreement to this new address unless you inform us otherwise. We will arrange an initial inspection for you new home. Initial inspection of your new home will be charged one-off payment of £30+VAT and your direct debit will continue as normal.",
      ],
      [
        "Governing Law",
        "The Terms & Conditions for all products and services are written in English and all correspondence entered into shall be in English. Your agreement in governed by Laws of England and Wales.",
      ],
      [
        "Design or Existing Faults",
        "We will not include the cost of repairs needed because of design faults or installation which have not been undertaken in line with building regulations or faults which existed before you entered into your agreement which we could not identify on our initial service or inspection of your boiler, particular appliance, system or electrical installation.",
      ],
      [
        "Accidental Damage / Third party Damage / Damage from Intentional Risk Taking",
        "Except where accidental damage caused by you is specifically stated as being included under your agreement, the cost of repairs relating to damage caused by is excluded from all agreements. All third-party works will not be included within our agreement.",
      ],
      [
        "Replacing your appliance",
        "We will provide an estimate with HeatCover+ plan discount £750. Discount does not apply to third party and can only be used with GPHE.",
      ],
      [
        "All other loss and damage",
        "Unless we are responsible for it, we will not include loss or damage to property (including any cleaning, plastering, painting etc. needed) or any other type of loss caused by appliance, boiler, system, plumbing or electrical installation to which this agreement relates (for example, damage to furniture or floors caused by water leaks). If access has to be made to your appliance, boiler, system, plumbing or electrics, any redecoration, repair or resurfacing of damage that may needed following our work is your responsibility, unless we have been negligent.",
      ],
      [
        "Risks normally insured under household or other insurances",
        "Except and only to the extent specifically stated as being included under a care plan, we will not include the repairs of faults or damage or replacement of appliance/systems or plumbing or electrics caused by freezing water conditions, subsidence, structural repairs, accident, fire, lightening, explosion, flood or storm. You should check you household insurance to make sure you have enough to cover these risks.",
      ],
      [
        "Using personal information",
        "We will not share any data or information in relation to you or your property without your written permission.",
      ],
    ] as const;

    for (const [title, text] of remainingConditions) {
      paragraph(`${title}: ${text}`);
    }

    heading("We will not Include the following");

    const exclusions = [
      "Replacing electrical appliance, bathroom fixtures, electric showers, boiling water taps and sanitary ware (except from boiler as described earlier).",
      "Improvements including work that is needed to bring your appliance, system or electrical installation to current standards/legislative requirements. Examples of these improvements include replacing parts such as flues, smoke alarms, vents that do not meet current standards, (these are examples only, not a complete list). You may need to have improvements carried out before we are able to complete other repairs to your appliance, system or electrical installation.",
      "Upgrades to which you may want to have carried out to improve your appliance, system or electrical installation. Examples of upgrades include replacing working radiators with improved models (these are examples only and not a complete list).",
      "Replacing or repairing parts that do not affect how the appliance, system or electrical installation works, decorative or specialist parts.",
      "Replacing feature or decorative radiators. We will provide a standard panel radiator of suitable size for the room.",
      "Resetting controls (for example, thermostats and programmers following changes due to winter or summer).",
      "We won’t attend property for faults that can be easily rectified by homeowner such as topping up system pressure or resetting tripped fuse. (these are examples only and not a complete list).",
      "Removing Asbestos.",
      "Repairing or replacing any lead, steel or iron pipes.",
      "The cost of repairing damage or breakdown caused by changes to, or problems with gas, electricity or water services.",
      "Repairing or replacing wall fixtures or fittings where we need access to make repair, such as tiles or wallpaper (these are examples only and not a complete list).",
    ];

    for (const item of exclusions) {
      bullet(item);
    }

    // -----------------------------
    // SEPARATE NEO U EQUIPMENT AGREEMENT (own pages)
    // -----------------------------
    if (withNeoU) {
      addPage();

      page.drawText("NEO U EQUIPMENT AGREEMENT", {
        x: MARGIN_X,
        y,
        size: 16,
        font: bold,
      });
      y -= 23;

      page.drawText("GammaTherm Neo U Oil Tank Level Monitor", {
        x: MARGIN_X,
        y,
        size: 11,
        font: bold,
      });
      y -= 28;

      heading("Agreement details");
      detail("Customer", `${firstName} ${lastName}`);
      detail("Installation address", `${address}, ${city}, ${postcode}`);
      detail("Linked plan", `HeatCover+ ${contract.displayName}`);
      detail("Monthly charge", "£6.00 (included in your HeatCover+ payment)");
      detail(
        "Installation fee",
        neoUInstallPence > 0
          ? `£${(neoUInstallPence / 100).toFixed(2)} one-off, with your first payment`
          : "As quoted at sign-up"
      );
      detail("Agreement date", formatDate(new Date()));
      detail("Reference", signupId);
      y -= 8;

      const neoUTerms: [string, string[]][] = [
        [
          "1. The service",
          [
            "Gamma Heating Ltd (\"we\", \"us\") will supply, install, configure and commission a GammaTherm Neo U oil tank level monitor (\"the Equipment\") at the installation address, and provide a weekly email report showing the approximate oil remaining in your tank.",
            "If the Equipment stops reporting for more than 7 days, we will email you asking you to contact us so we can check it.",
          ],
        ],
        [
          "2. Eligibility",
          [
            "The Neo U service is only available with an active HeatCover+ V4 plan. If your V4 plan ends for any reason, this agreement ends at the same time.",
          ],
        ],
        [
          "3. Charges",
          [
            "The one-off installation fee shown above is collected by Direct Debit together with your first HeatCover+ monthly payment.",
            "The £6.00 monthly charge is included in your HeatCover+ monthly Direct Debit for as long as this agreement is in place.",
          ],
        ],
        [
          "4. Ownership of the Equipment",
          [
            "The Equipment remains the property of Gamma Heating Ltd at all times. Paying the installation fee and the monthly charge does not transfer ownership of the Equipment to you.",
            "You must not sell, give away, remove, move, open, modify or tamper with the Equipment, or allow anyone else to do so.",
          ],
        ],
        [
          "5. Maintenance and repairs",
          [
            "We are responsible for maintaining the Equipment, including battery replacement, repairs and, where needed, replacement of faulty units, at no extra cost to you.",
            "This does not cover damage caused by misuse, tampering, accidental damage, or work carried out by anyone other than us. We may charge for repairs or replacement in these cases and will tell you the cost before any work is carried out.",
          ],
        ],
        [
          "6. Your responsibilities",
          [
            "You agree to give us reasonable access to your oil tank to install, maintain, repair, replace or remove the Equipment.",
            "Please tell us as soon as possible if the Equipment is damaged, stops reporting, or if your oil tank is replaced or moved.",
          ],
        ],
        [
          "7. Readings",
          [
            "Oil level readings are an estimate provided for guidance only. The Equipment is not a leak, theft or safety detection device. You remain responsible for ordering heating oil in good time, and we are not liable for any loss caused by running out of oil.",
            "The Equipment reports over a mobile data network. We do not guarantee uninterrupted reporting, for example where mobile signal is poor or unavailable.",
          ],
        ],
        [
          "8. Your information",
          [
            "We use your tank readings and contact details only to provide the Neo U service and your HeatCover+ plan.",
          ],
        ],
        [
          "9. Cancellation and ending this agreement",
          [
            "You have the right to cancel this agreement within 14 days of the agreement date without giving any reason. If you ask us to install the Equipment within that period and then cancel, we may deduct a proportionate amount for the work already carried out.",
            "After that, you can end the Neo U service at any time by contacting us. The £6.00 monthly charge will stop from your next payment. The installation fee is non-refundable once the Equipment has been installed, except as set out above.",
            "When this agreement ends, we will arrange to collect the Equipment. Please make it available for collection and do not dispose of it.",
          ],
        ],
        [
          "10. General",
          [
            "These terms form part of your HeatCover+ agreement. If anything in these terms conflicts with your HeatCover+ terms, these terms apply to the Neo U Equipment and service. This agreement is governed by the law of England and Wales.",
          ],
        ],
      ];

      for (const [title, paras] of neoUTerms) {
        heading(title);
        for (const text of paras) {
          paragraph(text);
        }
      }
    }

    const pages = pdfDoc.getPages();

    pages.forEach((pdfPage, index) => {
      pdfPage.drawText(
        `Gamma Heating | HeatCover+ ${contract.displayName} | Page ${index + 1} of ${pages.length}`,
        {
          x: MARGIN_X,
          y: 28,
          size: 7,
          font: regular,
        }
      );
    });

    const pdfBytes = await pdfDoc.save();
    
    console.log("🔥 REACHED HEATCOVER ZAPIER BLOCK");
    
    const zapierUrl = process.env.ZAPIER_HEATCOVER_CONTRACT_WEBHOOK_URL;

if (zapierUrl) {
  const formData = new FormData();

  formData.append("signupId", signupId);
  formData.append("customerName", `${firstName} ${lastName}`.trim());
  formData.append("firstName", firstName);
  formData.append("lastName", lastName);
  formData.append("customerEmail", email);
  formData.append("phone", phone || "");
  formData.append("address", address);
  formData.append("city", city);
  formData.append("postcode", postcode);

  formData.append("plan", contract.displayName);
  formData.append("planCode", contract.plan);
  formData.append(
    "monthlyAmount",
    contract.monthlyPrice.toFixed(2)
  );
  formData.append(
    "paymentDay",
    String(paymentDay)
  );
  formData.append(
    "excessFree",
    contract.excessFree ? "yes" : "no"
  );

  const pdfBuffer = Buffer.from(pdfBytes);

const pdfFile = new File(
  [pdfBuffer.buffer.slice(
    pdfBuffer.byteOffset,
    pdfBuffer.byteOffset + pdfBuffer.byteLength
  )],
  `heatcover-${variantKey}-${signupId}.pdf`,
  { type: "application/pdf" }
);

  formData.append("contract", pdfFile);

  const zapierRes = await fetch(zapierUrl, {
    method: "POST",
    body: formData,
  });

  if (!zapierRes.ok) {
    const zapierText = await zapierRes.text();

    console.error("HeatCover+ Zapier contract webhook failed:", {
      status: zapierRes.status,
      response: zapierText,
      signupId,
    });
  } else {
    console.log("HeatCover+ contract sent to Zapier:", {
      signupId,
      plan: contract.displayName,
      customerEmail: email,
    });
  }
} else {
  console.warn(
    "ZAPIER_HEATCOVER_CONTRACT_WEBHOOK_URL is not configured"
  );
}

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="heatcover-${variantKey}-${signupId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("HeatCover+ contract generation failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Could not generate HeatCover+ contract",
      },
      { status: 500 }
    );
  }
}