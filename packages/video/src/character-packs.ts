import { CharacterPack, CharacterProp } from "./character.js";

const expressions = {
  neutral: { browTilt: 0, mouthCurve: 0.15, eyeOpen: 1 },
  happy: { browTilt: 0.2, mouthCurve: 0.9, eyeOpen: 0.9 },
  shocked: { browTilt: 0.8, mouthCurve: 0, eyeOpen: 1.3 },
  thinking: { browTilt: -0.35, mouthCurve: -0.1, eyeOpen: 0.85 },
};
const capabilities = {
  arms: true,
  gaze: true,
  blink: true,
  talk: true,
  emotions: ["neutral", "happy", "shocked", "thinking"],
  gestures: ["point", "explain", "shrug", "think"],
};
const motion = {
  breathingAmplitude: 2,
  breathingPeriodFrames: 90,
  blinkIntervalFrames: 125,
  swayDegrees: 1.3,
  gazeLimit: 9,
  headTurnDegrees: 8,
  elbowBend: "outward",
};

const officialSource = {
  assetRef: "asset://shared/farq-official-layered-mascot@1",
  revisionId: "md7chc5vz33an9cd4jw8nm2bg98e9xfd",
  contentHash:
    "e946fed567d9ea44495d218e9cca31249883109031b566a443a7cf8b63e7e4ec",
  mimeType: "image/svg+xml" as const,
};
const officialScale = 0.28,
  officialCenter = { x: 627, y: 627 };

/** Compile authored absolute M/L/C SVG coordinates into pack-local coordinates. */
function officialPath(d: string, node = { x: 0, y: 0 }) {
  const tokens = d.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g);
  if (!tokens) throw new Error("Official mascot path is empty");
  let coordinate = 0;
  return tokens
    .map((token) => {
      if (/^[A-Za-z]$/.test(token)) {
        if (!["M", "L", "C", "Z"].includes(token))
          throw new Error(`Unsupported official mascot path command: ${token}`);
        coordinate = 0;
        return token;
      }
      const value = Number(token),
        isX = coordinate++ % 2 === 0,
        transformed =
          (value - (isX ? officialCenter.x : officialCenter.y)) *
            officialScale -
          (isX ? node.x : node.y);
      return Number(transformed.toFixed(3)).toString();
    })
    .join(" ");
}

function sourceEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fill: string,
  node = { x: 0, y: 0 },
) {
  return {
    kind: "ellipse" as const,
    x: (cx - officialCenter.x) * officialScale - node.x,
    y: (cy - officialCenter.y) * officialScale - node.y,
    rx: rx * officialScale,
    ry: ry * officialScale,
    fill,
  };
}

/** Examples only: actor rendering never branches on these pack IDs. */
export const builtInCharacterPacks: Record<string, CharacterPack> = {
  "farq-mascot": CharacterPack.parse({
    version: 1,
    id: "farq-mascot",
    label: "Farq mascot",
    viewBox: { width: 360, height: 340 },
    rig: {
      root: { x: 0, y: 0 },
      body: { x: 0, y: 0 },
      head: { x: 0, y: -35 },
      eyes: { x: 0, y: -48 },
      mouth: { x: 0, y: 3 },
      leftShoulder: { x: -62, y: 15 },
      leftElbow: { x: -112, y: 58 },
      leftHand: { x: -126, y: 106 },
      rightShoulder: { x: 62, y: 15 },
      rightElbow: { x: 112, y: 58 },
      rightHand: { x: 126, y: 106 },
    },
    capabilities,
    layers: [
      {
        id: "shadow",
        node: "root",
        shapes: [
          { kind: "ellipse", x: 0, y: 133, rx: 115, ry: 20, fill: "#00000040" },
        ],
      },
      {
        id: "mark",
        node: "body",
        shapes: [
          { kind: "ellipse", x: -56, y: -64, rx: 49, ry: 49, fill: "#ff7a1a" },
          { kind: "ellipse", x: 56, y: -6, rx: 49, ry: 49, fill: "#ff7a1a" },
          {
            kind: "path",
            d: "M-84 49 L84 -119",
            fill: "#00000000",
            stroke: "#ff7a1a",
            strokeWidth: 34,
          },
        ],
      },
      {
        id: "face",
        node: "head",
        shapes: [
          {
            kind: "ellipse",
            x: 0,
            y: 0,
            rx: 87,
            ry: 87,
            fill: "#fff8ee",
            stroke: "#211108",
            strokeWidth: 9,
          },
        ],
      },
    ],
    style: {
      limbColor: "#ff7a1a",
      limbWidth: 22,
      handRadius: 13,
      eyeColor: "#211108",
      eyeWhite: "#ffffff",
      eyeRadius: 23,
      eyeSpacing: 58,
      mouthColor: "#211108",
      mouthWidth: 48,
    },
    expressions,
    motion,
  }),
  "farq-official": CharacterPack.parse({
    version: 1,
    id: "farq-official",
    label: "Official farq.uz mascot",
    sourceAsset: officialSource,
    viewBox: { width: 360, height: 360 },
    rig: {
      root: { x: 0, y: 0 },
      body: { x: 0, y: 10 },
      head: { x: -34, y: -78 },
      eyes: { x: -34, y: -82 },
      mouth: { x: -40, y: -57 },
      leftShoulder: { x: -58, y: -32 },
      leftElbow: { x: -88, y: -5 },
      leftHand: { x: -112, y: 18 },
      rightShoulder: { x: 58, y: -32 },
      rightElbow: { x: 88, y: -5 },
      rightHand: { x: 112, y: 18 },
    },
    capabilities,
    layers: [
      {
        id: "officialShadow",
        node: "root",
        shapes: [sourceEllipse(670, 1097, 417, 35, "#c9c5c394")],
      },
      {
        id: "officialLegs",
        node: "root",
        shapes: [
          {
            kind: "path",
            d: officialPath(
              "M494 900 L562 873 C559 910 564 948 568 982 C570 997 562 1006 544 1006 C527 1006 514 992 505 980 C498 969 497 936 494 900 Z",
            ),
            fill: "#080808",
          },
          {
            kind: "path",
            d: officialPath(
              "M769 931 L844 926 C847 948 856 969 865 989 C851 996 834 1006 822 1019 C808 1020 800 1014 796 1003 C786 980 776 955 769 931 Z",
            ),
            fill: "#080808",
          },
        ],
      },
      {
        id: "officialHead",
        node: "head",
        shapes: [
          {
            kind: "path",
            d: officialPath(
              "M508 150 C619 149 702 220 720 315 C739 416 684 507 596 543 C515 576 415 557 353 495 C296 438 283 353 311 277 C343 189 420 151 508 150 Z",
              { x: -34, y: -78 },
            ),
            fill: "#07969e",
            stroke: "#050505",
            strokeWidth: 4,
          },
          {
            kind: "path",
            d: officialPath(
              "M493 159 C508 123 524 91 547 78 C564 68 583 70 604 73 L656 80 C684 84 705 99 726 122 C743 141 752 157 749 174 C746 195 731 230 713 259 Z",
              { x: -34, y: -78 },
            ),
            fill: "#080808",
            stroke: "#050505",
            strokeWidth: 4,
          },
          {
            kind: "path",
            d: officialPath(
              "M535 91 C551 84 570 86 590 89 C636 96 687 112 730 149 C741 159 746 168 745 177",
              { x: -34, y: -78 },
            ),
            fill: "#00000000",
            stroke: "#ffffff",
            strokeWidth: 5,
          },
          {
            kind: "path",
            d: officialPath("M505 137 C565 150 649 177 721 221", {
              x: -34,
              y: -78,
            }),
            fill: "#00000000",
            stroke: "#ffffff",
            strokeWidth: 3,
          },
          {
            kind: "path",
            d: officialPath("M581 119 L593 135 L582 153 L569 136 Z", {
              x: -34,
              y: -78,
            }),
            fill: "#ff5918",
          },
          {
            kind: "path",
            d: officialPath("M660 148 L671 165 L660 182 L647 165 Z", {
              x: -34,
              y: -78,
            }),
            fill: "#ff5918",
          },
          sourceEllipse(364, 401, 26, 17, "#ff5b18", { x: -34, y: -78 }),
          sourceEllipse(609, 443, 27, 18, "#ff5b18", { x: -34, y: -78 }),
        ],
      },
      {
        id: "officialPercent",
        node: "body",
        shapes: [
          {
            kind: "path",
            d: officialPath(
              "M818 624 C908 620 974 681 989 763 C1005 855 947 937 864 957 C775 979 686 930 657 849 C625 759 670 667 749 637 C771 629 794 625 818 624 Z",
              { x: 0, y: 10 },
            ),
            fill: "#07969e",
            stroke: "#050505",
            strokeWidth: 4,
          },
          {
            kind: "path",
            d: officialPath(
              "M819 735 C850 735 876 759 880 788 C884 821 861 849 831 855 C800 861 773 842 766 811 C758 778 779 745 809 737 C812 736 816 735 819 735 Z",
              { x: 0, y: 10 },
            ),
            fill: "#ffffff",
            stroke: "#050505",
            strokeWidth: 4,
          },
          {
            kind: "path",
            d: officialPath(
              "M432 929 C398 930 378 921 367 897 C356 873 363 846 382 821 L812 253 C834 224 858 220 893 221 L941 222 C977 223 996 240 1001 268 C1005 286 997 306 982 326 L554 891 C532 920 509 929 475 930 Z",
              { x: 0, y: 10 },
            ),
            fill: "#07969e",
            stroke: "#050505",
            strokeWidth: 4,
          },
        ],
      },
      {
        id: "officialShoes",
        node: "root",
        shapes: [
          {
            kind: "path",
            d: officialPath(
              "M497 962 C481 960 468 966 462 975 C452 977 448 981 444 985 C418 984 390 997 370 1013 C350 1029 340 1050 341 1071 C340 1091 356 1104 384 1109 C437 1119 526 1113 570 1099 C594 1093 605 1084 605 1067 C603 1039 599 1009 590 990 C585 979 577 973 568 971 L552 982 C533 978 514 970 497 962 Z",
            ),
            fill: "#080808",
          },
          {
            kind: "path",
            d: officialPath(
              "M379 1022 C400 1005 423 995 449 996 C456 989 461 986 470 985 C480 971 496 971 511 978 C524 985 531 995 536 1005 C551 1009 570 1002 571 986 C582 996 586 1020 590 1047 C555 1064 495 1074 443 1074 C434 1047 410 1023 379 1022 Z",
            ),
            fill: "#ff5918",
          },
          {
            kind: "path",
            d: officialPath(
              "M790 994 C780 1002 776 1017 774 1036 L771 1067 C769 1086 778 1098 798 1106 C844 1125 921 1135 969 1118 C993 1112 1007 1101 1008 1082 C1009 1062 992 1038 975 1025 C958 1012 940 1006 922 1002 C916 994 911 993 908 991 C893 974 877 970 860 975 L837 988 C820 985 803 987 790 994 Z",
            ),
            fill: "#080808",
          },
          {
            kind: "path",
            d: officialPath(
              "M795 1006 C800 1017 807 1020 822 1019 C835 997 851 986 870 986 C883 984 894 992 901 999 C910 1001 913 1007 917 1013 C940 1015 963 1028 978 1044 C943 1030 912 1054 894 1086 C856 1086 811 1073 785 1058 C786 1035 788 1019 795 1006 Z",
            ),
            fill: "#ff5918",
          },
        ],
      },
      {
        id: "officialAccents",
        node: "head",
        shapes: [
          {
            kind: "path",
            d: officialPath("M189 330 L142 294", { x: -34, y: -78 }),
            fill: "#00000000",
            stroke: "#ff5b18",
            strokeWidth: 7,
          },
          {
            kind: "path",
            d: officialPath("M234 297 L210 234", { x: -34, y: -78 }),
            fill: "#00000000",
            stroke: "#ff5b18",
            strokeWidth: 7,
          },
        ],
      },
    ],
    style: {
      limbColor: "#080808",
      limbWidth: 19,
      handRadius: 18,
      handColor: "#ffffff",
      handStroke: "#050505",
      handStrokeWidth: 4,
      eyeColor: "#050505",
      eyeWhite: "#ffffff",
      eyeRadius: 13,
      eyeSpacing: 50,
      mouthColor: "#050505",
      mouthWidth: 32,
    },
    expressions,
    motion: {
      ...motion,
      breathingAmplitude: 1.5,
      swayDegrees: 0.8,
      gazeLimit: 7,
      headTurnDegrees: 6,
    },
  }),
  customer: CharacterPack.parse({
    version: 1,
    id: "customer",
    label: "Customer",
    viewBox: { width: 360, height: 420 },
    rig: {
      root: { x: 0, y: 0 },
      body: { x: 0, y: 20 },
      head: { x: 0, y: -82 },
      eyes: { x: 0, y: -92 },
      mouth: { x: 0, y: -45 },
      leftShoulder: { x: -57, y: 6 },
      leftElbow: { x: -108, y: 55 },
      leftHand: { x: -124, y: 112 },
      rightShoulder: { x: 57, y: 6 },
      rightElbow: { x: 108, y: 55 },
      rightHand: { x: 124, y: 112 },
    },
    capabilities,
    layers: [
      {
        id: "shadow",
        node: "root",
        shapes: [
          { kind: "ellipse", x: 0, y: 148, rx: 100, ry: 18, fill: "#00000040" },
        ],
      },
      {
        id: "shirt",
        node: "body",
        shapes: [
          {
            kind: "rect",
            x: -68,
            y: -35,
            width: 136,
            height: 130,
            radius: 32,
            fill: "#347a90",
            stroke: "#173b48",
            strokeWidth: 7,
          },
        ],
      },
      {
        id: "legs",
        node: "root",
        shapes: [
          {
            kind: "rect",
            x: -48,
            y: 103,
            width: 32,
            height: 44,
            radius: 10,
            fill: "#173b48",
          },
          {
            kind: "rect",
            x: 16,
            y: 103,
            width: 32,
            height: 44,
            radius: 10,
            fill: "#173b48",
          },
        ],
      },
      {
        id: "face",
        node: "head",
        shapes: [
          {
            kind: "rect",
            x: -80,
            y: -78,
            width: 160,
            height: 166,
            radius: 52,
            fill: "#f2d7b6",
            stroke: "#211108",
            strokeWidth: 8,
          },
          {
            kind: "path",
            d: "M-82 -40 Q-86 -112 10 -90 Q88 -88 82 -32 L55 -53 Q5 -30 -24 -57 L-65 -25 Z",
            fill: "#38251e",
          },
        ],
      },
    ],
    style: {
      limbColor: "#f2d7b6",
      limbWidth: 20,
      handRadius: 12,
      eyeColor: "#211108",
      eyeWhite: "#ffffff",
      eyeRadius: 22,
      eyeSpacing: 62,
      mouthColor: "#211108",
      mouthWidth: 46,
    },
    expressions,
    motion: {
      ...motion,
      breathingAmplitude: 1.4,
      breathingPeriodFrames: 110,
      blinkIntervalFrames: 145,
      swayDegrees: 0.7,
      headTurnDegrees: 12,
    },
  }),
};

export const phoneCharacterProp: CharacterProp = CharacterProp.parse({
  label: "Phone",
  width: 66,
  height: 108,
  x: 0.5,
  y: 0.5,
  initiallyVisible: false,
  grip: { x: 0, y: 74 },
  shapes: [
    {
      kind: "rect",
      x: 0,
      y: 0,
      width: 66,
      height: 108,
      radius: 12,
      fill: "#211108",
      stroke: "#fff8ee",
      strokeWidth: 5,
    },
    {
      kind: "rect",
      x: 8,
      y: 13,
      width: 50,
      height: 78,
      radius: 6,
      fill: "#fff8ee",
    },
    {
      kind: "rect",
      x: 17,
      y: 24,
      width: 32,
      height: 8,
      radius: 4,
      fill: "#ff7a1a",
    },
    { kind: "ellipse", x: 33, y: 51, rx: 13, ry: 13, fill: "#ff7a1a" },
    {
      kind: "path",
      d: "M26 51 L31 56 L41 45",
      fill: "#00000000",
      stroke: "#211108",
      strokeWidth: 4,
    },
    { kind: "ellipse", x: 33, y: 99, rx: 4, ry: 4, fill: "#fff8ee" },
  ],
});
