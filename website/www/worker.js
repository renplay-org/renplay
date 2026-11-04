// www.renplay.org sends every request to the same path on renplay.org.
export default {
  fetch(request) {
    const url = new URL(request.url)
    url.hostname = 'renplay.org'
    return Response.redirect(url.toString(), 301)
  },
}
