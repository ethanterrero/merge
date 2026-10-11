export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        ComputedFields: never
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      commute_crews: {
        Row: {
          created_at: string
          departure_time: string
          ended_at: string | null
          id: string
          proposed_by: string | null
          responded_at: string | null
          status: string
          user_high: string | null
          user_low: string | null
          weekdays: number[]
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          departure_time: string
          ended_at?: string | null
          id?: string
          proposed_by?: string | null
          responded_at?: string | null
          status?: string
          user_high?: string | null
          user_low?: string | null
          weekdays: number[]
        }
        Update: {
          created_at?: string
          departure_time?: string
          ended_at?: string | null
          id?: string
          proposed_by?: string | null
          responded_at?: string | null
          status?: string
          user_high?: string | null
          user_low?: string | null
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "commute_crews_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commute_crews_user_high_fkey"
            columns: ["user_high"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commute_crews_user_low_fkey"
            columns: ["user_low"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      commutes: {
        Row: {
          brings_scooter: boolean
          created_at: string
          departure_flex_minutes: number
          departure_time: string
          destination: unknown
          destination_area: unknown
          destination_area_label: string
          id: string
          max_detour_minutes: number
          origin: unknown
          origin_area: unknown
          origin_area_label: string
          owner_id: string
          role: string
          seats_offered: number | null
          timezone: string
          vehicle_id: string | null
          weekdays: number[]
        }
        ComputedFields: never
        Insert: {
          brings_scooter?: boolean
          created_at?: string
          departure_flex_minutes?: number
          departure_time: string
          destination: unknown
          destination_area: unknown
          destination_area_label: string
          id?: string
          max_detour_minutes?: number
          origin: unknown
          origin_area: unknown
          origin_area_label: string
          owner_id: string
          role: string
          seats_offered?: number | null
          timezone?: string
          vehicle_id?: string | null
          weekdays: number[]
        }
        Update: {
          brings_scooter?: boolean
          created_at?: string
          departure_flex_minutes?: number
          departure_time?: string
          destination?: unknown
          destination_area?: unknown
          destination_area_label?: string
          id?: string
          max_detour_minutes?: number
          origin?: unknown
          origin_area?: unknown
          origin_area_label?: string
          owner_id?: string
          role?: string
          seats_offered?: number | null
          timezone?: string
          vehicle_id?: string | null
          weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "commutes_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commutes_vehicle_owner_fkey"
            columns: ["vehicle_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      connections: {
        Row: {
          created_at: string
          crew_eligible: boolean
          updated_at: string
          user_high: string
          user_low: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          crew_eligible?: boolean
          updated_at?: string
          user_high: string
          user_low: string
        }
        Update: {
          created_at?: string
          crew_eligible?: boolean
          updated_at?: string
          user_high?: string
          user_low?: string
        }
        Relationships: [
          {
            foreignKeyName: "connections_user_high_fkey"
            columns: ["user_high"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connections_user_low_fkey"
            columns: ["user_low"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          commute_id: string | null
          created_at: string
          crew_id: string | null
          id: string
          recipient_id: string | null
          ride_date: string
          sender_id: string | null
          status: string
        }
        ComputedFields: never
        Insert: {
          commute_id?: string | null
          created_at?: string
          crew_id?: string | null
          id?: string
          recipient_id?: string | null
          ride_date: string
          sender_id?: string | null
          status?: string
        }
        Update: {
          commute_id?: string | null
          created_at?: string
          crew_id?: string | null
          id?: string
          recipient_id?: string | null
          ride_date?: string
          sender_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_commute_id_fkey"
            columns: ["commute_id"]
            isOneToOne: false
            referencedRelation: "commutes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_crew_id_fkey"
            columns: ["crew_id"]
            isOneToOne: false
            referencedRelation: "commute_crews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invitations_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      place_boundaries: {
        Row: {
          city: string
          geom: unknown
          id: string
          kind: string
          license: string
          name: string
          source: string
        }
        ComputedFields: never
        Insert: {
          city: string
          geom: unknown
          id: string
          kind: string
          license: string
          name: string
          source: string
        }
        Update: {
          city?: string
          geom?: unknown
          id?: string
          kind?: string
          license?: string
          name?: string
          source?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          discovery_opt_in: boolean
          display_name: string
          id: string
          ride_prefs: string[]
          role: string
          suspended_at: string | null
          vetted_at: string | null
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          discovery_opt_in?: boolean
          display_name: string
          id: string
          ride_prefs?: string[]
          role?: string
          suspended_at?: string | null
          vetted_at?: string | null
        }
        Update: {
          created_at?: string
          discovery_opt_in?: boolean
          display_name?: string
          id?: string
          ride_prefs?: string[]
          role?: string
          suspended_at?: string | null
          vetted_at?: string | null
        }
        Relationships: []
      }
      ride_feedback: {
        Row: {
          author_id: string
          created_at: string
          dismissed_at: string | null
          experience: string | null
          ride_again: string | null
          ride_again_at: string | null
          ride_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          author_id: string
          created_at?: string
          dismissed_at?: string | null
          experience?: string | null
          ride_again?: string | null
          ride_again_at?: string | null
          ride_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          created_at?: string
          dismissed_at?: string | null
          experience?: string | null
          ride_again?: string | null
          ride_again_at?: string | null
          ride_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ride_feedback_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ride_feedback_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      rides: {
        Row: {
          completed_at: string | null
          created_at: string
          driver_id: string | null
          id: string
          invitation_id: string
          kind: string
          passenger_id: string | null
          pickup_time: string
          ride_date: string
          status: string
        }
        ComputedFields: never
        Insert: {
          completed_at?: string | null
          created_at?: string
          driver_id?: string | null
          id?: string
          invitation_id: string
          kind: string
          passenger_id?: string | null
          pickup_time: string
          ride_date: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          driver_id?: string | null
          id?: string
          invitation_id?: string
          kind?: string
          passenger_id?: string | null
          pickup_time?: string
          ride_date?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "rides_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rides_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: true
            referencedRelation: "invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rides_passenger_id_fkey"
            columns: ["passenger_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_reports: {
        Row: {
          account_deleted_at: string | null
          category: string
          created_at: string
          details: string | null
          id: string
          reported_user_id: string | null
          reporter_id: string | null
          ride_id: string | null
        }
        ComputedFields: never
        Insert: {
          account_deleted_at?: string | null
          category: string
          created_at?: string
          details?: string | null
          id?: string
          reported_user_id?: string | null
          reporter_id?: string | null
          ride_id?: string | null
        }
        Update: {
          account_deleted_at?: string | null
          category?: string
          created_at?: string
          details?: string | null
          id?: string
          reported_user_id?: string | null
          reporter_id?: string | null
          ride_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "safety_reports_reported_user_id_fkey"
            columns: ["reported_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_reports_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          accepts_foldable_scooters: boolean
          color: string | null
          created_at: string
          id: string
          make: string
          model: string
          model_year: number | null
          owner_id: string
          passenger_seats: number
          plate: string | null
        }
        ComputedFields: never
        Insert: {
          accepts_foldable_scooters?: boolean
          color?: string | null
          created_at?: string
          id?: string
          make: string
          model: string
          model_year?: number | null
          owner_id: string
          passenger_seats: number
          plate?: string | null
        }
        Update: {
          accepts_foldable_scooters?: boolean
          color?: string | null
          created_at?: string
          id?: string
          make?: string
          model?: string
          model_year?: number | null
          owner_id?: string
          passenger_seats?: number
          plate?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      area_label: { Args: { center: unknown }; Returns: string }
      area_radius_m: { Args: Record<PropertyKey, never>; Returns: number }
      commute_area_for: {
        Args: {
          for_owner: string
          pin: unknown
          self_id: string
          sibling: unknown
        }
        Returns: unknown
      }
      detour_limit_minutes: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      detour_road_factor: { Args: Record<PropertyKey, never>; Returns: number }
      detour_speed_mph: { Args: Record<PropertyKey, never>; Returns: number }
      estimate_detour_minutes: {
        Args: {
          driver_dest: unknown
          driver_origin: unknown
          pax_dest: unknown
          pax_origin: unknown
        }
        Returns: number
      }
      estimate_trip_minutes: {
        Args: { dest: unknown; origin: unknown }
        Returns: number
      }
      find_matches: {
        Args: { ride_date: string; role_filter?: string }
        Returns: {
          area_radius_m: number
          brings_scooter: boolean
          connected: boolean
          departure_gap_minutes: number
          departure_time: string
          destination_area_label: string
          destination_area_lat: number
          destination_area_lng: number
          detour_band: string
          name: string
          origin_area_label: string
          origin_area_lat: number
          origin_area_lng: number
          other_id: string
          rank: number
          reasons: Json
          ride_prefs: string[]
          role: string
          scooter_fits: boolean
          seats_offered: number
          seats_open: number
          shared_weekdays: number[]
          vetted: boolean
          window_end: string
          window_start: string
        }[]
      }
      is_active: { Args: { uid: string }; Returns: boolean }
      is_blocked: { Args: { a: string; b: string }; Returns: boolean }
      is_detour_within_limit: {
        Args: {
          driver_dest: unknown
          driver_origin: unknown
          pax_dest: unknown
          pax_origin: unknown
        }
        Returns: boolean
      }
      is_vetted: { Args: { uid: string }; Returns: boolean }
      match_candidates: {
        Args: { me: string; ride_date: string }
        Returns: {
          connected: boolean
          departure_gap_minutes: number
          detour_minutes: number
          my_commute_id: string
          other_commute_id: string
          other_id: string
          pax_brings_scooter: boolean
          reaches_hov: boolean
          role: string
          scooter_fits: boolean
          seats_offered: number
          seats_open: number
          shared_prefs: string[]
          shared_weekdays: number[]
        }[]
      }
      match_days_label: { Args: { days: number[] }; Returns: string }
      match_prefilter: {
        Args: {
          driver_dest: unknown
          driver_origin: unknown
          pax_dest_area: unknown
          pax_origin_area: unknown
        }
        Returns: boolean
      }
      propose_crew: {
        Args: { departure_time: string; other: string; weekdays: number[] }
        Returns: string
      }
      public_name: { Args: { display_name: string }; Returns: string }
      purge_expired_safety_reports: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      random_area_center: { Args: { pin: unknown }; Returns: unknown }
      relabel_commute_areas: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      resolve_connection: { Args: { a: string; b: string }; Returns: undefined }
      respond_to_crew: {
        Args: { accept: boolean; crew_id: string }
        Returns: undefined
      }
      road_minutes: { Args: { meters: number }; Returns: number }
      set_crew_status: {
        Args: { crew_id: string; status: string }
        Returns: undefined
      }
      withdraw_member: { Args: { uid: string }; Returns: undefined }
      within_area: { Args: { area: unknown; spot: unknown }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
