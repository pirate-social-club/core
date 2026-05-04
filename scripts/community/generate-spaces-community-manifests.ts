#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type CommunityInput = {
  root: string;
  display_name: string;
  country_code: string;
  description?: string;
};

type InputFile = {
  communities: CommunityInput[];
};

type CommunityState = {
  community_id?: string | null;
  route_slug?: string | null;
  status?: string;
};

type StateFile = Record<string, CommunityState>;

type Options = {
  inputPath: string;
  outputDir: string;
  statePath: string | null;
  overwrite: boolean;
};

function usage(exitCode = 1): never {
  console.error(`Usage:
  rtk bun scripts/community/generate-spaces-community-manifests.ts \\
    --input scripts/community/spaces-communities.flags-draft.json \\
    --output ../pirate-data/communities-generated \\
    [--state scripts/community/spaces-communities-state.json] \\
    [--overwrite]

Generates community.yaml, description.txt, rules.txt, labels.json, safety.json,
donation.json, and translation-notes.json for each input community.`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    inputPath: "",
    outputDir: "",
    statePath: null,
    overwrite: false,
  };

  for (let index = 0; index < argv.length; ) {
    const arg = argv[index];
    const value = argv[index + 1] ?? "";
    switch (arg) {
      case "--input":
        options.inputPath = resolve(value);
        index += 2;
        break;
      case "--output":
        options.outputDir = resolve(value);
        index += 2;
        break;
      case "--state":
        options.statePath = resolve(value);
        index += 2;
        break;
      case "--overwrite":
        options.overwrite = true;
        index += 1;
        break;
      case "-h":
      case "--help":
        usage(0);
        break;
      default:
        console.error(`unknown argument: ${arg}`);
        usage();
    }
  }

  if (!options.inputPath || !options.outputDir) {
    usage();
  }
  return options;
}

function canonicalSpacesRoot(value: string): string {
  const label = value.trim().normalize("NFKC").toLowerCase().replace(/^@/u, "");
  if (!label || label.includes(".")) {
    throw new Error(`invalid Spaces root label: ${value}`);
  }
  const hostname = new URL(`http://${label}.invalid`).hostname;
  const canonical = hostname.slice(0, -".invalid".length);
  if (!canonical || canonical.includes(".")) {
    throw new Error(`invalid Spaces root label: ${value}`);
  }
  return canonical;
}

function topicName(displayName: string): string {
  return displayName
    .replace(/^\p{Regional_Indicator}{2}\s*/u, "")
    .trim();
}

function descriptionFor(topic: string): string {
  return `A community for discussing ${topic} and topics related to it. All viewpoints and opinions are welcome here, but please read the rules in the sidebar before posting.`;
}

function rulesFor(topic: string): string {
  const topicLower = topic.toLowerCase();
  return [
    [
      "R1: Be respectful",
      "Treat other members as people. Personal attacks, harassment, threats, slurs, and targeted insults are not allowed. Argue the point, not the person.",
    ],
    [
      "R2: No bad faith behavior",
      "Do not troll, brigade, bait other users, sealion, spam talking points, impersonate locals, or derail threads. Repeated low-effort antagonism may be removed even when no single comment is severe.",
    ],
    [
      "R3: Media policy",
      "Images and videos must be relevant, accurately described, and safe for the community. Nudity, adult, explicit sexual, fetish, and suggestive sexual imagery are not allowed. Graphic violence may be removed or escalated for review.",
    ],
    [
      "R4: Post title policy",
      "Use clear, neutral, descriptive titles. Do not editorialize news headlines, use misleading framing, add rage bait, or write titles that hide the actual topic.",
    ],
    [
      "R5: No reposts / One post per topic",
      "Check recent posts before submitting. Reposts, duplicate links, and multiple posts about the same narrow event may be removed so discussion stays consolidated.",
    ],
    [
      `R6: Posts must be related to ${topic}`,
      `Posts should be directly about ${topicLower}, people from ${topic}, its culture, politics, history, economy, daily life, diaspora, language, travel, or international issues that clearly involve ${topic}.`,
    ],
    [
      "R7: Submit the best source format",
      "Prefer primary sources, original reporting, official documents, archived links, or direct media over screenshots and secondhand summaries. Add context when the source may be unclear to outsiders.",
    ],
    [
      "R8: No meta-drama or off-platform drama",
      "Do not use this community to continue fights from other communities, social networks, group chats, or moderation disputes. Discuss the topic, not drama around the topic.",
    ],
    [
      "R9: Posts with \"Serious\" flair are held to higher standards",
      "Serious threads should stay on topic, substantive, and evidence-aware. Jokes, memes, drive-by replies, and intentionally inflammatory comments may be removed more quickly in Serious threads.",
    ],
    [
      "R10: Daily posting limit",
      "Avoid flooding the feed. As a default, do not submit more than three top-level posts per day unless moderators explicitly approve more for a breaking-news situation.",
    ],
    [
      "R11: Translate non-English post titles",
      "If posting in a language other than English, please translate at least the post title into English. Native-language discussion is welcome, but titles should be understandable to the wider community.",
    ],
  ].map(([title, body]) => `${title}\n${body}`).join("\n\n");
}

function labelsJson(): string {
  return JSON.stringify({
    label_enabled: true,
    require_label_on_top_level_posts: false,
    definitions: [
      { label: "News", color_token: "blue", status: "active", position: 0 },
      { label: "Discussion", color_token: "green", status: "active", position: 1 },
      { label: "Question", color_token: "purple", status: "active", position: 2 },
      { label: "Culture", color_token: "pink", status: "active", position: 3 },
      { label: "History", color_token: "amber", status: "active", position: 4 },
      { label: "Politics", color_token: "red", status: "active", position: 5 },
      { label: "Economy", color_token: "slate", status: "active", position: 6 },
      { label: "Travel", color_token: "cyan", status: "active", position: 7 },
      { label: "Media", color_token: "orange", status: "active", position: 8 },
      { label: "Serious", color_token: "zinc", status: "active", position: 9 },
    ],
  }, null, 2) + "\n";
}

function safetyJson(): string {
  return JSON.stringify({
    adult_content_policy: {
      suggestive: "disallow",
      artistic_nudity: "disallow",
      explicit_nudity: "disallow",
      explicit_sexual_content: "disallow",
      fetish_content: "disallow",
    },
    graphic_content_policy: {
      injury_medical: "review",
      gore: "disallow",
      extreme_gore: "disallow",
      body_horror_disturbing: "disallow",
      animal_harm: "disallow",
    },
    civility_policy: {
      group_directed_demeaning_language: "disallow",
      targeted_insults: "disallow",
      targeted_harassment: "disallow",
      threatening_language: "disallow",
    },
    openai_moderation_settings: {
      scan_titles: true,
      scan_post_bodies: true,
      scan_captions: true,
      scan_link_preview_text: true,
      scan_images: true,
    },
  }, null, 2) + "\n";
}

function donationJson(): string {
  return JSON.stringify({ donation_policy_mode: "none" }, null, 2) + "\n";
}

function readState(path: string | null): StateFile {
  if (!path || !existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as StateFile;
}

function writeNew(path: string, contents: string, overwrite: boolean): void {
  if (existsSync(path) && !overwrite) return;
  writeFileSync(path, contents);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const input = JSON.parse(readFileSync(options.inputPath, "utf8")) as InputFile;
  const state = readState(options.statePath);
  mkdirSync(options.outputDir, { recursive: true });

  let count = 0;
  for (const community of input.communities) {
    const rootLabel = canonicalSpacesRoot(community.root);
    const topic = topicName(community.display_name);
    const folder = join(options.outputDir, `@${rootLabel}`);
    const stateEntry = state[rootLabel] ?? null;
    mkdirSync(folder, { recursive: true });

    const communityIdLine = stateEntry?.community_id
      ? `community_id: ${stateEntry.community_id}\n`
      : "";
    const routeSlug = stateEntry?.route_slug ?? `@${rootLabel}`;
    writeNew(join(folder, "community.yaml"), [
      communityIdLine.trimEnd(),
      `route_slug: ${routeSlug}`,
      `display_name: ${community.display_name}`,
      "description_file: description.txt",
      "rules_file: rules.txt",
      "labels_file: labels.json",
      "safety_file: safety.json",
      "donation_policy_file: donation.json",
      "",
    ].filter((line, index) => line || index === 0 && Boolean(communityIdLine)).join("\n"), options.overwrite);

    writeNew(join(folder, "description.txt"), `${descriptionFor(topic)}\n`, options.overwrite);
    writeNew(join(folder, "rules.txt"), `${rulesFor(topic)}\n`, options.overwrite);
    writeNew(join(folder, "labels.json"), labelsJson(), options.overwrite);
    writeNew(join(folder, "safety.json"), safetyJson(), options.overwrite);
    writeNew(join(folder, "donation.json"), donationJson(), options.overwrite);
    writeNew(join(folder, "translation-notes.json"), JSON.stringify({
      root: community.root,
      root_label: rootLabel,
      country_code: community.country_code,
      topic,
      translation_status: "needs_native_language_review",
      translate: ["description.txt", "rules.txt"],
      keep_rule_ids: true,
      notes: [
        "Translate to the dominant local language when appropriate, but keep English fallback text if the community is multilingual.",
        "Keep R1-R11 identifiers stable so moderation references remain consistent across communities.",
        "For R11, replace the generic non-English note with the specific local-language expectation where useful.",
      ],
    }, null, 2) + "\n", options.overwrite);
    count += 1;
  }

  process.stdout.write(`generated ${count} community manifest folders in ${options.outputDir}\n`);
}

main();
