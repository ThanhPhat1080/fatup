package dev.fatup.app

import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import okio.source
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

const val MAX_FILE_SIZE = 100L * 1024 * 1024

fun isImage(mime: String) = mime.lowercase().startsWith("image/")

/** [permanent] errors will not succeed on retry (bad request, too large, auth). */
class ApiException(message: String, val status: Int, val permanent: Boolean) : IOException(message)

data class UploadTicket(val id: String, val uploadUrl: String, val thumbUploadUrl: String?)

class Api(
    private val connection: Connection,
    private val client: OkHttpClient = defaultClient,
) {
    private val json = "application/json".toMediaTypeOrNull()

    private fun request(path: String) = Request.Builder()
        .url(connection.serverUrl + path)
        .header("Authorization", "Bearer ${connection.token}")

    private fun execute(req: Request): JSONObject {
        client.newCall(req).execute().use { res ->
            val body = res.body.string()
            if (!res.isSuccessful) {
                val message = runCatching { JSONObject(body).getJSONObject("error").getString("message") }
                    .getOrDefault("HTTP ${res.code}")
                throw ApiException(message, res.code, permanent = res.code in 400..499 && res.code != 408 && res.code != 429)
            }
            return if (body.isBlank()) JSONObject() else JSONObject(body)
        }
    }

    /** Checks URL and token together. */
    fun verify() {
        execute(request("/me").get().build())
    }

    fun createUpload(name: String, mime: String, size: Long, hasThumb: Boolean, device: String): UploadTicket {
        val payload = JSONObject()
            .put("name", name)
            .put("mime", mime)
            .put("size", size)
            .put("hasThumb", hasThumb)
            .put("device", device)
        val res = execute(request("/uploads").post(payload.toString().toRequestBody(json)).build())
        return UploadTicket(
            id = res.getString("id"),
            uploadUrl = res.getString("uploadUrl"),
            thumbUploadUrl = if (res.isNull("thumbUploadUrl")) null else res.getString("thumbUploadUrl"),
        )
    }

    /** Bookmarks a link; the server fetches its preview later. [title] is optional (share sheets rarely send a useful one). */
    fun createLink(url: String, title: String?, device: String) {
        val payload = JSONObject().put("url", url).put("device", device)
        if (title != null) payload.put("title", title)
        execute(request("/links").post(payload.toString().toRequestBody(json)).build())
    }

    fun complete(id: String) {
        execute(request("/uploads/$id/complete").post(ByteArray(0).toRequestBody(json)).build())
    }

    /** PUTs a file straight to R2 using a presigned URL. */
    fun putFile(url: String, file: File, mime: String, onProgress: (Long) -> Unit = {}) {
        val body = ProgressBody(file, mime, onProgress)
        client.newCall(Request.Builder().url(url).put(body).build()).execute().use { res ->
            if (!res.isSuccessful) {
                // An expired presigned URL returns 403; a fresh ticket on retry fixes it.
                throw ApiException("Upload failed: HTTP ${res.code}", res.code, permanent = false)
            }
        }
    }

    private class ProgressBody(
        private val file: File,
        private val mime: String,
        private val onProgress: (Long) -> Unit,
    ) : RequestBody() {
        override fun contentType() = mime.toMediaTypeOrNull()
        override fun contentLength() = file.length()
        override fun writeTo(sink: BufferedSink) {
            file.source().use { source ->
                var total = 0L
                while (true) {
                    val read = source.read(sink.buffer, 64 * 1024)
                    if (read == -1L) break
                    total += read
                    sink.flush()
                    onProgress(total)
                }
            }
        }
    }

    companion object {
        val defaultClient: OkHttpClient by lazy {
            OkHttpClient.Builder()
                .connectTimeout(20, TimeUnit.SECONDS)
                .readTimeout(60, TimeUnit.SECONDS)
                .writeTimeout(120, TimeUnit.SECONDS)
                .build()
        }
    }
}
