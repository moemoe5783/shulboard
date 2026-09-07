export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      album_items: {
        Row: {
          album_id: string
          asset_id: string
          caption: string | null
          created_at: string
          id: string
          org_id: string
          position: number
        }
        Insert: {
          album_id: string
          asset_id: string
          caption?: string | null
          created_at?: string
          id?: string
          org_id: string
          position: number
        }
        Update: {
          album_id?: string
          asset_id?: string
          caption?: string | null
          created_at?: string
          id?: string
          org_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "album_items_album_fk"
            columns: ["album_id", "org_id"]
            referencedRelation: "albums"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "album_items_asset_fk"
            columns: ["asset_id", "org_id"]
            referencedRelation: "assets"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "album_items_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      albums: {
        Row: {
          cover_asset_id: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          id: string
          moderation_required: boolean
          name: string
          org_id: string
          share_enabled: boolean
          share_expires_at: string | null
          share_token: string | null
          source: Database["public"]["Enums"]["album_source"]
          source_config: Json | null
          updated_at: string
        }
        Insert: {
          cover_asset_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          moderation_required?: boolean
          name: string
          org_id: string
          share_enabled?: boolean
          share_expires_at?: string | null
          share_token?: string | null
          source?: Database["public"]["Enums"]["album_source"]
          source_config?: Json | null
          updated_at?: string
        }
        Update: {
          cover_asset_id?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          id?: string
          moderation_required?: boolean
          name?: string
          org_id?: string
          share_enabled?: boolean
          share_expires_at?: string | null
          share_token?: string | null
          source?: Database["public"]["Enums"]["album_source"]
          source_config?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "albums_cover_asset_fk"
            columns: ["cover_asset_id", "org_id"]
            referencedRelation: "assets"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "albums_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          asset_id: string | null
          body: string | null
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          is_pinned: boolean
          org_id: string
          priority: number
          starts_at: string | null
          status: Database["public"]["Enums"]["announcement_status"]
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          asset_id?: string | null
          body?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          is_pinned?: boolean
          org_id: string
          priority?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["announcement_status"]
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          asset_id?: string | null
          body?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          is_pinned?: boolean
          org_id?: string
          priority?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["announcement_status"]
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "announcements_asset_fk"
            columns: ["asset_id", "org_id"]
            referencedRelation: "assets"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "announcements_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          aspect_ratio: number | null
          byte_size: number | null
          caption: string | null
          checksum_sha256: string | null
          created_at: string
          deleted_at: string | null
          duration_seconds: number | null
          exif_stripped: boolean
          height: number | null
          id: string
          kind: Database["public"]["Enums"]["asset_kind"]
          mime_type: string
          moderation_status: Database["public"]["Enums"]["moderation_status"]
          org_id: string
          original_filename: string | null
          processing_error: string | null
          status: Database["public"]["Enums"]["asset_status"]
          storage_bucket: string
          storage_path: string
          updated_at: string
          upload_source: Database["public"]["Enums"]["upload_source"]
          uploaded_by: string | null
          variants: NonNullable<Json>
          width: number | null
        }
        Insert: {
          aspect_ratio?: never
          byte_size?: number | null
          caption?: string | null
          checksum_sha256?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          exif_stripped?: boolean
          height?: number | null
          id?: string
          kind: Database["public"]["Enums"]["asset_kind"]
          mime_type: string
          moderation_status?: Database["public"]["Enums"]["moderation_status"]
          org_id: string
          original_filename?: string | null
          processing_error?: string | null
          status?: Database["public"]["Enums"]["asset_status"]
          storage_bucket?: string
          storage_path: string
          updated_at?: string
          upload_source?: Database["public"]["Enums"]["upload_source"]
          uploaded_by?: string | null
          variants?: NonNullable<Json>
          width?: number | null
        }
        Update: {
          aspect_ratio?: never
          byte_size?: number | null
          caption?: string | null
          checksum_sha256?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_seconds?: number | null
          exif_stripped?: boolean
          height?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["asset_kind"]
          mime_type?: string
          moderation_status?: Database["public"]["Enums"]["moderation_status"]
          org_id?: string
          original_filename?: string | null
          processing_error?: string | null
          status?: Database["public"]["Enums"]["asset_status"]
          storage_bucket?: string
          storage_path?: string
          updated_at?: string
          upload_source?: Database["public"]["Enums"]["upload_source"]
          uploaded_by?: string | null
          variants?: NonNullable<Json>
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_kind: Database["public"]["Enums"]["audit_actor_kind"]
          actor_user_id: string | null
          changed: Json | null
          created_at: string
          entity_id: string | null
          entity_table: string
          id: number
          ip: unknown
          org_id: string
          summary: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_kind?: Database["public"]["Enums"]["audit_actor_kind"]
          actor_user_id?: string | null
          changed?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_table: string
          id?: never
          ip?: unknown
          org_id: string
          summary?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_kind?: Database["public"]["Enums"]["audit_actor_kind"]
          actor_user_id?: string | null
          changed?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_table?: string
          id?: never
          ip?: unknown
          org_id?: string
          summary?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      boards: {
        Row: {
          canvas_height: number
          canvas_width: number
          created_at: string
          created_by: string | null
          deleted_at: string | null
          doc: NonNullable<Json>
          doc_version: number
          id: string
          is_template: boolean
          name: string
          org_id: string
          template_category: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          canvas_height?: number
          canvas_width?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          doc?: NonNullable<Json>
          doc_version?: number
          id?: string
          is_template?: boolean
          name: string
          org_id: string
          template_category?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          canvas_height?: number
          canvas_width?: number
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          doc?: NonNullable<Json>
          doc_version?: number
          id?: string
          is_template?: boolean
          name?: string
          org_id?: string
          template_category?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boards_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_connections: {
        Row: {
          account_email: string | null
          calendar_id: string
          calendar_name: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          last_synced_at: string | null
          org_id: string
          provider: Database["public"]["Enums"]["calendar_provider"]
          sync_error: string | null
          sync_status: Database["public"]["Enums"]["sync_status"]
          sync_token: string | null
          updated_at: string
          vault_secret_id: string | null
        }
        Insert: {
          account_email?: string | null
          calendar_id: string
          calendar_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          org_id: string
          provider?: Database["public"]["Enums"]["calendar_provider"]
          sync_error?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status"]
          sync_token?: string | null
          updated_at?: string
          vault_secret_id?: string | null
        }
        Update: {
          account_email?: string | null
          calendar_id?: string
          calendar_name?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          org_id?: string
          provider?: Database["public"]["Enums"]["calendar_provider"]
          sync_error?: string | null
          sync_status?: Database["public"]["Enums"]["sync_status"]
          sync_token?: string | null
          updated_at?: string
          vault_secret_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_connections_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          connection_id: string
          created_at: string
          description: string | null
          end_date: string | null
          ends_at: string | null
          external_id: string
          html_link: string | null
          ical_uid: string | null
          id: string
          is_all_day: boolean
          location: string | null
          org_id: string
          recurring_event_id: string | null
          remote_etag: string | null
          remote_updated_at: string | null
          start_date: string | null
          starts_at: string | null
          status: Database["public"]["Enums"]["calendar_event_status"]
          synced_at: string
          timezone: string | null
          title: string
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          description?: string | null
          end_date?: string | null
          ends_at?: string | null
          external_id: string
          html_link?: string | null
          ical_uid?: string | null
          id?: string
          is_all_day?: boolean
          location?: string | null
          org_id: string
          recurring_event_id?: string | null
          remote_etag?: string | null
          remote_updated_at?: string | null
          start_date?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["calendar_event_status"]
          synced_at?: string
          timezone?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          description?: string | null
          end_date?: string | null
          ends_at?: string | null
          external_id?: string
          html_link?: string | null
          ical_uid?: string | null
          id?: string
          is_all_day?: boolean
          location?: string | null
          org_id?: string
          recurring_event_id?: string | null
          remote_etag?: string | null
          remote_updated_at?: string | null
          start_date?: string | null
          starts_at?: string | null
          status?: Database["public"]["Enums"]["calendar_event_status"]
          synced_at?: string
          timezone?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_connection_fk"
            columns: ["connection_id", "org_id"]
            referencedRelation: "calendar_connections"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "calendar_events_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      org_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          org_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["org_role"]
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at: string
          id?: string
          invited_by?: string | null
          org_id: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["org_role"]
          token: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["org_role"]
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_invites_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          created_at: string
          invited_by: string | null
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          invited_by?: string | null
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          invited_by?: string | null
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_members_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      orgs: {
        Row: {
          country_code: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          elevation_m: number | null
          hebrew_prefs: NonNullable<Json>
          id: string
          latitude: number | null
          longitude: number | null
          myzmanim_location_id: string | null
          name: string
          nusach: Database["public"]["Enums"]["nusach"]
          plan: string
          postal_code: string | null
          screen_limit: number | null
          slug: string
          theme: NonNullable<Json>
          timezone: string
          updated_at: string
          zmanim_provider: Database["public"]["Enums"]["zmanim_provider"]
        }
        Insert: {
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          elevation_m?: number | null
          hebrew_prefs?: NonNullable<Json>
          id?: string
          latitude?: number | null
          longitude?: number | null
          myzmanim_location_id?: string | null
          name: string
          nusach?: Database["public"]["Enums"]["nusach"]
          plan?: string
          postal_code?: string | null
          screen_limit?: number | null
          slug: string
          theme?: NonNullable<Json>
          timezone?: string
          updated_at?: string
          zmanim_provider?: Database["public"]["Enums"]["zmanim_provider"]
        }
        Update: {
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          elevation_m?: number | null
          hebrew_prefs?: NonNullable<Json>
          id?: string
          latitude?: number | null
          longitude?: number | null
          myzmanim_location_id?: string | null
          name?: string
          nusach?: Database["public"]["Enums"]["nusach"]
          plan?: string
          postal_code?: string | null
          screen_limit?: number | null
          slug?: string
          theme?: NonNullable<Json>
          timezone?: string
          updated_at?: string
          zmanim_provider?: Database["public"]["Enums"]["zmanim_provider"]
        }
        Relationships: []
      }
      people: {
        Row: {
          birth_after_sunset: boolean
          birth_date_gregorian: string | null
          birth_hebrew_day: number | null
          birth_hebrew_month: string | null
          birth_hebrew_year: number | null
          burial_date_gregorian: string | null
          commemorated_by: string | null
          created_at: string
          created_by: string | null
          death_after_sunset: boolean
          death_date_gregorian: string | null
          death_hebrew_day: number | null
          death_hebrew_month: string | null
          death_hebrew_year: number | null
          deleted_at: string | null
          display_name: string
          father_hebrew_name: string | null
          first_name: string | null
          gender: Database["public"]["Enums"]["person_gender"]
          hebrew_name: string | null
          id: string
          last_name: string | null
          mother_hebrew_name: string | null
          notes: string | null
          org_id: string
          photo_asset_id: string | null
          show_on_boards: boolean
          updated_at: string
          updated_by: string | null
          yahrzeit_first_year_rule: string | null
        }
        Insert: {
          birth_after_sunset?: boolean
          birth_date_gregorian?: string | null
          birth_hebrew_day?: number | null
          birth_hebrew_month?: string | null
          birth_hebrew_year?: number | null
          burial_date_gregorian?: string | null
          commemorated_by?: string | null
          created_at?: string
          created_by?: string | null
          death_after_sunset?: boolean
          death_date_gregorian?: string | null
          death_hebrew_day?: number | null
          death_hebrew_month?: string | null
          death_hebrew_year?: number | null
          deleted_at?: string | null
          display_name: string
          father_hebrew_name?: string | null
          first_name?: string | null
          gender?: Database["public"]["Enums"]["person_gender"]
          hebrew_name?: string | null
          id?: string
          last_name?: string | null
          mother_hebrew_name?: string | null
          notes?: string | null
          org_id: string
          photo_asset_id?: string | null
          show_on_boards?: boolean
          updated_at?: string
          updated_by?: string | null
          yahrzeit_first_year_rule?: string | null
        }
        Update: {
          birth_after_sunset?: boolean
          birth_date_gregorian?: string | null
          birth_hebrew_day?: number | null
          birth_hebrew_month?: string | null
          birth_hebrew_year?: number | null
          burial_date_gregorian?: string | null
          commemorated_by?: string | null
          created_at?: string
          created_by?: string | null
          death_after_sunset?: boolean
          death_date_gregorian?: string | null
          death_hebrew_day?: number | null
          death_hebrew_month?: string | null
          death_hebrew_year?: number | null
          deleted_at?: string | null
          display_name?: string
          father_hebrew_name?: string | null
          first_name?: string | null
          gender?: Database["public"]["Enums"]["person_gender"]
          hebrew_name?: string | null
          id?: string
          last_name?: string | null
          mother_hebrew_name?: string | null
          notes?: string | null
          org_id?: string
          photo_asset_id?: string | null
          show_on_boards?: boolean
          updated_at?: string
          updated_by?: string | null
          yahrzeit_first_year_rule?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "people_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_photo_asset_fk"
            columns: ["photo_asset_id", "org_id"]
            referencedRelation: "assets"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      playlist_items: {
        Row: {
          board_id: string
          created_at: string
          duration_seconds: number | null
          id: string
          is_enabled: boolean
          org_id: string
          playlist_id: string
          position: number
          priority: number
          schedule: NonNullable<Json>
          updated_at: string
        }
        Insert: {
          board_id: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          is_enabled?: boolean
          org_id: string
          playlist_id: string
          position: number
          priority?: number
          schedule?: NonNullable<Json>
          updated_at?: string
        }
        Update: {
          board_id?: string
          created_at?: string
          duration_seconds?: number | null
          id?: string
          is_enabled?: boolean
          org_id?: string
          playlist_id?: string
          position?: number
          priority?: number
          schedule?: NonNullable<Json>
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_items_board_fk"
            columns: ["board_id", "org_id"]
            referencedRelation: "boards"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "playlist_items_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_items_playlist_fk"
            columns: ["playlist_id", "org_id"]
            referencedRelation: "playlists"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      playlists: {
        Row: {
          created_at: string
          created_by: string | null
          default_duration_seconds: number
          description: string | null
          id: string
          name: string
          org_id: string
          transition: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_duration_seconds?: number
          description?: string | null
          id?: string
          name: string
          org_id: string
          transition?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_duration_seconds?: number
          description?: string | null
          id?: string
          name?: string
          org_id?: string
          transition?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "playlists_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      schedules: {
        Row: {
          applies_on: NonNullable<Json>
          created_at: string
          created_by: string | null
          days_of_week: number[]
          effective_from: string | null
          effective_to: string | null
          fixed_time: string | null
          hebrew_label: string | null
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["schedule_kind"]
          label: string
          location_note: string | null
          notes: string | null
          org_id: string
          position: number
          time_kind: Database["public"]["Enums"]["schedule_time_kind"]
          updated_at: string
          updated_by: string | null
          zman_id: string | null
          zman_offset_minutes: number | null
        }
        Insert: {
          applies_on?: NonNullable<Json>
          created_at?: string
          created_by?: string | null
          days_of_week?: number[]
          effective_from?: string | null
          effective_to?: string | null
          fixed_time?: string | null
          hebrew_label?: string | null
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["schedule_kind"]
          label: string
          location_note?: string | null
          notes?: string | null
          org_id: string
          position?: number
          time_kind?: Database["public"]["Enums"]["schedule_time_kind"]
          updated_at?: string
          updated_by?: string | null
          zman_id?: string | null
          zman_offset_minutes?: number | null
        }
        Update: {
          applies_on?: NonNullable<Json>
          created_at?: string
          created_by?: string | null
          days_of_week?: number[]
          effective_from?: string | null
          effective_to?: string | null
          fixed_time?: string | null
          hebrew_label?: string | null
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["schedule_kind"]
          label?: string
          location_note?: string | null
          notes?: string | null
          org_id?: string
          position?: number
          time_kind?: Database["public"]["Enums"]["schedule_time_kind"]
          updated_at?: string
          updated_by?: string | null
          zman_id?: string | null
          zman_offset_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "schedules_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
        ]
      }
      screen_bundles: {
        Row: {
          build_duration_ms: number | null
          built_at: string
          byte_size: number
          content_hash: string
          created_at: string
          org_id: string
          payload: NonNullable<Json>
          screen_id: string
          source_versions: Json | null
          ttl_seconds: number
          updated_at: string
          version: number
        }
        Insert: {
          build_duration_ms?: number | null
          built_at?: string
          byte_size: number
          content_hash: string
          created_at?: string
          org_id: string
          payload: NonNullable<Json>
          screen_id: string
          source_versions?: Json | null
          ttl_seconds?: number
          updated_at?: string
          version?: number
        }
        Update: {
          build_duration_ms?: number | null
          built_at?: string
          byte_size?: number
          content_hash?: string
          created_at?: string
          org_id?: string
          payload?: NonNullable<Json>
          screen_id?: string
          source_versions?: Json | null
          ttl_seconds?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "screen_bundles_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screen_bundles_screen_fk"
            columns: ["screen_id", "org_id"]
            referencedRelation: "screens"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      screen_heartbeats: {
        Row: {
          app_version: string | null
          beat_count: number
          board_id: string | null
          bucket_hour: string
          bundle_version: number | null
          created_at: string
          error_count: number
          first_beat_at: string
          ip: unknown
          last_beat_at: string
          last_error: string | null
          max_gap_seconds: number | null
          org_id: string
          screen_id: string
          updated_at: string
          uptime_seconds: number | null
          user_agent: string | null
          viewport_height: number | null
          viewport_width: number | null
        }
        Insert: {
          app_version?: string | null
          beat_count?: number
          board_id?: string | null
          bucket_hour: string
          bundle_version?: number | null
          created_at?: string
          error_count?: number
          first_beat_at?: string
          ip?: unknown
          last_beat_at?: string
          last_error?: string | null
          max_gap_seconds?: number | null
          org_id: string
          screen_id: string
          updated_at?: string
          uptime_seconds?: number | null
          user_agent?: string | null
          viewport_height?: number | null
          viewport_width?: number | null
        }
        Update: {
          app_version?: string | null
          beat_count?: number
          board_id?: string | null
          bucket_hour?: string
          bundle_version?: number | null
          created_at?: string
          error_count?: number
          first_beat_at?: string
          ip?: unknown
          last_beat_at?: string
          last_error?: string | null
          max_gap_seconds?: number | null
          org_id?: string
          screen_id?: string
          updated_at?: string
          uptime_seconds?: number | null
          user_agent?: string | null
          viewport_height?: number | null
          viewport_width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "screen_heartbeats_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screen_heartbeats_screen_fk"
            columns: ["screen_id", "org_id"]
            referencedRelation: "screens"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      screens: {
        Row: {
          canvas_height: number
          canvas_width: number
          created_at: string
          elevation_m: number | null
          hebrew_prefs: NonNullable<Json>
          id: string
          is_active: boolean
          last_seen_at: string | null
          last_seen_board_id: string | null
          last_seen_bundle_version: number | null
          latitude: number | null
          location_note: string | null
          longitude: number | null
          name: string
          org_id: string
          orientation: Database["public"]["Enums"]["screen_orientation"]
          pairing_code: string | null
          pairing_code_expires_at: string | null
          playlist_id: string | null
          postal_code: string | null
          rebuild_attempts: number
          rebuild_last_attempt_at: string | null
          rebuild_last_error: string | null
          rebuild_requested_at: string | null
          timezone: string | null
          token: string
          token_rotated_at: string | null
          updated_at: string
          zmanim_location_id: string | null
          zmanim_provider: Database["public"]["Enums"]["zmanim_provider"] | null
        }
        Insert: {
          canvas_height?: number
          canvas_width?: number
          created_at?: string
          elevation_m?: number | null
          hebrew_prefs?: NonNullable<Json>
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          last_seen_board_id?: string | null
          last_seen_bundle_version?: number | null
          latitude?: number | null
          location_note?: string | null
          longitude?: number | null
          name: string
          org_id: string
          orientation?: Database["public"]["Enums"]["screen_orientation"]
          pairing_code?: string | null
          pairing_code_expires_at?: string | null
          playlist_id?: string | null
          postal_code?: string | null
          rebuild_attempts?: number
          rebuild_last_attempt_at?: string | null
          rebuild_last_error?: string | null
          rebuild_requested_at?: string | null
          timezone?: string | null
          token: string
          token_rotated_at?: string | null
          updated_at?: string
          zmanim_location_id?: string | null
          zmanim_provider?:
            | Database["public"]["Enums"]["zmanim_provider"]
            | null
        }
        Update: {
          canvas_height?: number
          canvas_width?: number
          created_at?: string
          elevation_m?: number | null
          hebrew_prefs?: NonNullable<Json>
          id?: string
          is_active?: boolean
          last_seen_at?: string | null
          last_seen_board_id?: string | null
          last_seen_bundle_version?: number | null
          latitude?: number | null
          location_note?: string | null
          longitude?: number | null
          name?: string
          org_id?: string
          orientation?: Database["public"]["Enums"]["screen_orientation"]
          pairing_code?: string | null
          pairing_code_expires_at?: string | null
          playlist_id?: string | null
          postal_code?: string | null
          rebuild_attempts?: number
          rebuild_last_attempt_at?: string | null
          rebuild_last_error?: string | null
          rebuild_requested_at?: string | null
          timezone?: string | null
          token?: string
          token_rotated_at?: string | null
          updated_at?: string
          zmanim_location_id?: string | null
          zmanim_provider?:
            | Database["public"]["Enums"]["zmanim_provider"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "screens_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "orgs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "screens_playlist_fk"
            columns: ["playlist_id", "org_id"]
            referencedRelation: "playlists"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      zmanim_cache: {
        Row: {
          date: string
          fetched_at: string
          location_id: string
          provider: Database["public"]["Enums"]["zmanim_provider"]
          raw_response: Json | null
          source_version: string | null
          times: NonNullable<Json>
          timezone: string
        }
        Insert: {
          date: string
          fetched_at?: string
          location_id: string
          provider: Database["public"]["Enums"]["zmanim_provider"]
          raw_response?: Json | null
          source_version?: string | null
          times: NonNullable<Json>
          timezone: string
        }
        Update: {
          date?: string
          fetched_at?: string
          location_id?: string
          provider?: Database["public"]["Enums"]["zmanim_provider"]
          raw_response?: Json | null
          source_version?: string | null
          times?: NonNullable<Json>
          timezone?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_org_ids: { Args: Record<PropertyKey, never>; Returns: string[] }
      has_org_role_at_least: {
        Args: { min_role: string; org: string }
        Returns: boolean
      }
      is_org_member: { Args: { org: string }; Returns: boolean }
      record_bundle_build_failure: {
        Args: { p_error: string; p_screen_id: string }
        Returns: undefined
      }
      record_heartbeat: {
        Args: {
          p_app_version?: string
          p_board_id?: string
          p_bundle_version?: number
          p_error_count?: number
          p_last_error?: string
          p_org_id: string
          p_screen_id: string
          p_uptime_seconds?: number
          p_user_agent?: string
          p_viewport_height?: number
          p_viewport_width?: number
        }
        Returns: undefined
      }
    }
    Enums: {
      album_source: "manual" | "drive" | "photos_import" | "email"
      announcement_status: "draft" | "published" | "archived"
      asset_kind: "image" | "video"
      asset_status: "pending" | "processing" | "ready" | "failed"
      audit_actor_kind: "user" | "system" | "share_link"
      calendar_event_status: "confirmed" | "tentative" | "cancelled"
      calendar_provider: "google"
      moderation_status: "approved" | "pending" | "rejected"
      nusach: "ashkenaz" | "sefard" | "ari" | "edot_hamizrach"
      org_role: "viewer" | "editor" | "admin" | "owner"
      person_gender: "male" | "female" | "unspecified"
      schedule_kind: "davening" | "shiur" | "other"
      schedule_time_kind: "fixed" | "zman_relative"
      screen_orientation: "landscape" | "portrait"
      sync_status: "never" | "ok" | "error"
      upload_source: "dashboard" | "share_link"
      zmanim_provider: "hebcal" | "chabad" | "myzmanim" | "manual"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      album_source: ["manual", "drive", "photos_import", "email"],
      announcement_status: ["draft", "published", "archived"],
      asset_kind: ["image", "video"],
      asset_status: ["pending", "processing", "ready", "failed"],
      audit_actor_kind: ["user", "system", "share_link"],
      calendar_event_status: ["confirmed", "tentative", "cancelled"],
      calendar_provider: ["google"],
      moderation_status: ["approved", "pending", "rejected"],
      nusach: ["ashkenaz", "sefard", "ari", "edot_hamizrach"],
      org_role: ["viewer", "editor", "admin", "owner"],
      person_gender: ["male", "female", "unspecified"],
      schedule_kind: ["davening", "shiur", "other"],
      schedule_time_kind: ["fixed", "zman_relative"],
      screen_orientation: ["landscape", "portrait"],
      sync_status: ["never", "ok", "error"],
      upload_source: ["dashboard", "share_link"],
      zmanim_provider: ["hebcal", "chabad", "myzmanim", "manual"],
    },
  },
} as const
