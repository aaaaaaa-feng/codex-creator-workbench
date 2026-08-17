import type { Metadata } from "next";
import Workbench from "./workbench";

export const metadata: Metadata = {
  title: `${process.env.NEXT_PUBLIC_CREATOR_NAME || "本地"} AI 自媒体工作台`,
  description: "从 AIHOT 灵感到口播、封面与复盘的本地内容生产工作台。",
};

export default function Home() {
  return <Workbench />;
}
