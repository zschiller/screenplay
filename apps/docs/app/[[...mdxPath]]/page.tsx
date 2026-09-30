import { generateStaticParamsFor, importPage } from "nextra/pages"
import { CopyPage } from "../../components/copy-page"
import { PageNav } from "../../components/page-nav"
import { useMDXComponents as getMDXComponents } from "../../mdx-components"

export const generateStaticParams = generateStaticParamsFor("mdxPath")

type PageProps = {
  params: Promise<{ mdxPath: string[] }>
}

export async function generateMetadata(props: PageProps) {
  const params = await props.params
  const { metadata } = await importPage(params.mdxPath)
  return metadata
}

const Wrapper = getMDXComponents().wrapper!

export default async function Page(props: PageProps) {
  const params = await props.params
  const result = await importPage(params.mdxPath)
  const { default: MDXContent, toc, metadata, sourceCode } = result
  return (
    <Wrapper toc={toc} metadata={metadata} sourceCode={sourceCode}>
      {/* Our split button in place of Nextra's, which layout.tsx turns off. */}
      {sourceCode && <CopyPage sourceCode={sourceCode} />}
      <MDXContent {...props} params={params} />
      {/* Our buttons in place of Nextra's pagination, which layout.tsx turns off. */}
      <PageNav />
    </Wrapper>
  )
}
