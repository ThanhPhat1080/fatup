package dev.fatup.app

import android.content.Context
import android.os.Build
import androidx.core.content.edit
import java.net.URI
import java.net.URLDecoder

data class Connection(val serverUrl: String, val token: String)

/** Connection settings, kept in the app's private SharedPreferences. */
class Config(context: Context) {
    private val prefs = context.getSharedPreferences("fatup", Context.MODE_PRIVATE)

    var connection: Connection?
        get() {
            val url = prefs.getString(KEY_URL, null) ?: return null
            val token = prefs.getString(KEY_TOKEN, null) ?: return null
            return Connection(url, token)
        }
        set(value) {
            prefs.edit {
                if (value == null) {
                    remove(KEY_URL)
                    remove(KEY_TOKEN)
                } else {
                    putString(KEY_URL, value.serverUrl)
                    putString(KEY_TOKEN, value.token)
                }
            }
        }

    val deviceName: String
        get() = Build.MODEL?.takeIf { it.isNotBlank() } ?: "Android"

    private companion object {
        const val KEY_URL = "server_url"
        const val KEY_TOKEN = "token"
    }
}

object SetupLink {
    /** Parses the QR payload `fatup://setup?url=…&token=…` shown by the desktop app. */
    fun parse(raw: String): Connection? {
        val uri = runCatching { URI(raw.trim()) }.getOrNull() ?: return null
        if (uri.scheme != "fatup" || uri.host != "setup") return null
        val params = (uri.rawQuery ?: return null).split('&').mapNotNull { pair ->
            val i = pair.indexOf('=')
            if (i <= 0) null else pair.substring(0, i) to URLDecoder.decode(pair.substring(i + 1), "UTF-8")
        }.toMap()
        val url = params["url"]?.let(::normalizeServerUrl) ?: return null
        val token = params["token"]?.takeIf { it.isNotBlank() } ?: return null
        return Connection(url, token)
    }

    fun normalizeServerUrl(raw: String): String? {
        var url = raw.trim()
        if (url.isEmpty()) return null
        if (!url.startsWith("http://", true) && !url.startsWith("https://", true)) url = "https://$url"
        val uri = runCatching { URI(url) }.getOrNull() ?: return null
        if (uri.host.isNullOrEmpty()) return null
        return url.trimEnd('/')
    }
}
