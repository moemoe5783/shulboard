export default async function DisplayPage({ params }: PageProps<"/s/[token]">) {
  const { token } = await params;

  return (
    <main>
      <h1>Display</h1>
      <p>Token: {token}</p>
    </main>
  );
}
