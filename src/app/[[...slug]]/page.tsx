import type { Metadata } from "next";
import { CodeScape } from "@/components/CodeScape";

export async function generateMetadata({ params }: PageProps<"/[[...slug]]">): Promise<Metadata> {
  const { slug } = await params;
  if (slug && slug.length >= 2) {
    const name = `${decodeURIComponent(slug[0])}/${decodeURIComponent(slug[1])}`;
    return {
      title: `${name} · CodeScape`,
      description: `Explore ${name} as a miniature 3D city built from its real file structure.`,
    };
  }
  return {};
}

export default function Page() {
  // The client reads the path itself (see CodeScape). That keeps the WebGL
  // canvas mounted as people move between cities.
  return <CodeScape />;
}
