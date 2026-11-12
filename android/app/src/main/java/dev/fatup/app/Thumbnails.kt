package dev.fatup.app

import android.graphics.Bitmap
import android.graphics.ImageDecoder
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt

object Thumbnails {
    const val MAX_EDGE = 400

    /** Scales (w, h) so the longer edge is at most [maxEdge]; never upscales. */
    fun targetSize(width: Int, height: Int, maxEdge: Int = MAX_EDGE): Pair<Int, Int> {
        if (width <= 0 || height <= 0) return maxEdge to maxEdge
        val longest = max(width, height)
        if (longest <= maxEdge) return width to height
        val scale = maxEdge.toDouble() / longest
        return max(1, (width * scale).roundToInt()) to max(1, (height * scale).roundToInt())
    }

    /**
     * Writes a small JPEG preview of [source] to [out]. ImageDecoder handles HEIC and
     * applies EXIF orientation. Returns false when the image cannot be decoded.
     */
    fun create(source: File, out: File): Boolean = runCatching {
        val bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(source)) { decoder, info, _ ->
            val (w, h) = targetSize(info.size.width, info.size.height)
            decoder.setTargetSize(w, h)
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
        out.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 80, it) }
        bitmap.recycle()
        true
    }.getOrDefault(false)
}
