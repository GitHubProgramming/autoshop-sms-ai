# Default ProGuard rules
-keepattributes Signature
-keepattributes *Annotation*

# Room DB entities and DAOs
-keep class com.proteros.smsai.data.** { *; }

# Google API client
-keep class com.google.api.** { *; }
-keep class com.google.api.services.** { *; }
-dontwarn com.google.api.**
-dontwarn com.google.common.**

# Gson serialization
-keepclassmembers class * {
    @com.google.gson.annotations.SerializedName <fields>;
}
-keep class com.google.gson.** { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

# Keep BroadcastReceivers
-keep class com.proteros.smsai.receiver.** { *; }

# Keep service
-keep class com.proteros.smsai.service.** { *; }
