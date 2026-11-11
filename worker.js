export default {
  async fetch(request, env) {
    // Handle CORS preflight requests from your frontend app
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    const url = new URL(request.url);
    const gistPath = url.pathname; // e.g., /gists or /gists/GIST_ID

    // Forward the request to GitHub Gists API
    const githubUrl = `https://api.github.com${gistPath}${url.search}`;

    const modifiedHeaders = new Headers(request.headers);
    modifiedHeaders.set("Authorization", `Bearer ${env.GITHUB_TOKEN}`);
    modifiedHeaders.set("User-Agent", "Faith-and-Focus-App");
    modifiedHeaders.set("Accept", "application/vnd.github+json");

    try {
      const response = await fetch(githubUrl, {
        method: request.method,
        headers: modifiedHeaders,
        body: ["GET", "HEAD"].includes(request.method) ? null : request.body,
      });

      const responseHeaders = new Headers(response.headers);
      responseHeaders.set("Access-Control-Allow-Origin": "*");

      return new Response(response.body, {
        status: response.status,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      });
    }
  },
};