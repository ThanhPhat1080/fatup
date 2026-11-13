package dev.fatup.app

import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/** Picks web links out of what other apps share. Mirrors `extractUrl` in shared/src/index.ts. */
object Links {
    private val LINK = Regex("""https?://[^\s<>"']+""", RegexOption.IGNORE_CASE)
    private val TRAILING = Regex("""[.,;:!?)\]}>]+$""")

    /** The first http(s) link in [text], tidied by OkHttp (lowercase host, trailing slash), or null. */
    fun extractUrl(text: String?): String? {
        val match = LINK.find(text ?: return null) ?: return null
        return match.value.replace(TRAILING, "").toHttpUrlOrNull()?.toString()
    }

    /** A shared subject is only worth keeping as a title when it says more than the link itself. */
    fun cleanTitle(raw: String?, url: String): String? {
        val title = raw?.trim().orEmpty()
        if (title.isEmpty() || title.startsWith("http://", true) || title.startsWith("https://", true) || title == url) return null
        return title.take(255)
    }
}
