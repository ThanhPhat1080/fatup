package dev.fatup.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.UUID

/** Invisible activity that receives files from the Android share sheet. */
class ShareActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Config(this).connection == null) {
            toast(getString(R.string.error_not_configured))
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }
        val uris = sharedUris(intent)
        if (uris.isEmpty()) {
            finish()
            return
        }
        lifecycleScope.launch {
            val (batch, rejected) = withContext(Dispatchers.IO) { copyToCache(uris) }
            if (rejected > 0) toast(resources.getQuantityString(R.plurals.too_large, rejected, rejected))
            if (batch != null) {
                UploadWorker.enqueue(applicationContext, batch)
                val count = Batch.load(batch)?.total ?: 0
                toast(resources.getQuantityString(R.plurals.sending_files, count, count))
            }
            finish()
        }
    }

    private fun sharedUris(intent: Intent): List<Uri> = when (intent.action) {
        Intent.ACTION_SEND -> listOfNotNull(parcelable(intent, Intent.EXTRA_STREAM))
        Intent.ACTION_SEND_MULTIPLE -> parcelables(intent, Intent.EXTRA_STREAM)
        else -> emptyList()
    }

    @Suppress("DEPRECATION")
    private fun parcelable(intent: Intent, key: String): Uri? =
        if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(key, Uri::class.java) else intent.getParcelableExtra(key)

    @Suppress("DEPRECATION")
    private fun parcelables(intent: Intent, key: String): List<Uri> =
        (if (Build.VERSION.SDK_INT >= 33) intent.getParcelableArrayListExtra(key, Uri::class.java) else intent.getParcelableArrayListExtra(key))
            ?.toList() ?: emptyList()

    /**
     * Copies shared content into the app's own storage, because read access to the
     * URIs ends when this activity finishes. Returns the batch file and how many items were too large.
     */
    private fun copyToCache(uris: List<Uri>): Pair<File?, Int> {
        val dir = File(filesDir, "outgoing").apply { mkdirs() }
        val entries = mutableListOf<Entry>()
        var rejected = 0
        for (uri in uris) {
            val (name, declaredSize) = queryMeta(uri)
            if (declaredSize != null && declaredSize > MAX_FILE_SIZE) {
                rejected++
                continue
            }
            val mime = contentResolver.getType(uri) ?: guessMime(name)
            val target = File(dir, UUID.randomUUID().toString())
            val result = runCatching {
                contentResolver.openInputStream(uri)?.use { input ->
                    target.outputStream().use { out -> copyLimited(input, out, MAX_FILE_SIZE) }
                }
            }
            val copied = result.getOrNull()
            if (copied == null) {
                target.delete()
                if (result.exceptionOrNull() is TooLargeException) rejected++
                continue
            }
            entries += Entry(target.absolutePath, name, mime, copied)
        }
        if (entries.isEmpty()) return null to rejected
        val batchFile = File(dir, "batch-${UUID.randomUUID()}.json")
        Batch(entries).save(batchFile)
        return batchFile to rejected
    }

    private fun queryMeta(uri: Uri): Pair<String, Long?> {
        var name: String? = null
        var size: Long? = null
        runCatching {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    val ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val si = c.getColumnIndex(OpenableColumns.SIZE)
                    if (ni >= 0 && !c.isNull(ni)) name = c.getString(ni)
                    if (si >= 0 && !c.isNull(si)) size = c.getLong(si)
                }
            }
        }
        return (name ?: uri.lastPathSegment?.substringAfterLast('/') ?: "file") to size
    }

    private fun toast(text: String) = Toast.makeText(applicationContext, text, Toast.LENGTH_SHORT).show()
}

class TooLargeException : java.io.IOException("File exceeds limit")

/** Copies at most [limit] bytes; throws [TooLargeException] if the stream is longer. Returns bytes copied. */
fun copyLimited(input: java.io.InputStream, output: java.io.OutputStream, limit: Long): Long {
    val buffer = ByteArray(64 * 1024)
    var total = 0L
    while (true) {
        val read = input.read(buffer)
        if (read < 0) break
        total += read
        if (total > limit) throw TooLargeException()
        output.write(buffer, 0, read)
    }
    return total
}

fun guessMime(name: String): String = when (name.substringAfterLast('.', "").lowercase()) {
    "jpg", "jpeg" -> "image/jpeg"
    "png" -> "image/png"
    "heic" -> "image/heic"
    "heif" -> "image/heif"
    "webp" -> "image/webp"
    "gif" -> "image/gif"
    "pdf" -> "application/pdf"
    "txt" -> "text/plain"
    "doc" -> "application/msword"
    "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    "xls" -> "application/vnd.ms-excel"
    "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    "zip" -> "application/zip"
    "mp4" -> "video/mp4"
    else -> "application/octet-stream"
}
