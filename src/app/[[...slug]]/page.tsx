import type { Metadata } from "next";
import { CodeScape } from "@/components/CodeScape";

export async function generateMetadata({ params }: PageProps<"/[[...slug]]">): Promise<Metadata> {
  const { slug } = await params;
  if (slug?.length === 1 && slug[0] === "local") {
    return { title: "Local repository · CodeScape", description: "A repository on this machine, analysed locally by CodeScape." };
  }
  if (slug && slug.length >= 2) {
    const name = `${decodeURIComponent(slug[0])}/${decodeURIComponent(slug[1])}`;
    return {
      title: `${name} · CodeScape`,
      description: `Explore ${name}: modules, entry points, dependencies and code journeys as a 3D architecture map.`,
    };
  }
  return {};
}

export default function Page() {
  // The client reads the path itself (see CodeScape). That keeps the WebGL
  // canvas mounted as people move between cities.
  return <CodeScape />;
}
