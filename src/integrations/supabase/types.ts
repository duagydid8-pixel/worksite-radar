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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      anomaly_data: {
        Row: {
          bansa: number
          created_at: string
          gyeol: number
          id: string
          jigak: number
          mita: number
          month: number
          name: string
          year: number
          yeoncha: number
        }
        Insert: {
          bansa?: number
          created_at?: string
          gyeol?: number
          id?: string
          jigak?: number
          mita?: number
          month: number
          name: string
          year: number
          yeoncha?: number
        }
        Update: {
          bansa?: number
          created_at?: string
          gyeol?: number
          id?: string
          jigak?: number
          mita?: number
          month?: number
          name?: string
          year?: number
          yeoncha?: number
        }
        Relationships: []
      }
      attendance_data: {
        Row: {
          created_at: string
          days_json: Json
          id: string
          job: string
          month: number
          name: string
          team: string
          year: number
        }
        Insert: {
          created_at?: string
          days_json?: Json
          id?: string
          job?: string
          month: number
          name: string
          team: string
          year: number
        }
        Update: {
          created_at?: string
          days_json?: Json
          id?: string
          job?: string
          month?: number
          name?: string
          team?: string
          year?: number
        }
        Relationships: []
      }
      leave_details: {
        Row: {
          created_at: string
          day: number
          days: number
          id: string
          month: number
          name: string
          reason: string
          year: number
        }
        Insert: {
          created_at?: string
          day: number
          days?: number
          id?: string
          month: number
          name: string
          reason?: string
          year: number
        }
        Update: {
          created_at?: string
          day?: number
          days?: number
          id?: string
          month?: number
          name?: string
          reason?: string
          year?: number
        }
        Relationships: []
      }
      leave_employees: {
        Row: {
          accrued: number
          created_at: string
          dept: string
          hire_date: string
          id: string
          name: string
          remaining: number
          total_used: number
        }
        Insert: {
          accrued?: number
          created_at?: string
          dept?: string
          hire_date?: string
          id?: string
          name: string
          remaining?: number
          total_used?: number
        }
        Update: {
          accrued?: number
          created_at?: string
          dept?: string
          hire_date?: string
          id?: string
          name?: string
          remaining?: number
          total_used?: number
        }
        Relationships: []
      }
      upload_metadata: {
        Row: {
          file_name: string | null
          id: string
          record_count: number
          uploaded_at: string
        }
        Insert: {
          file_name?: string | null
          id?: string
          record_count?: number
          uploaded_at?: string
        }
        Update: {
          file_name?: string | null
          id?: string
          record_count?: number
          uploaded_at?: string
        }
        Relationships: []
      }
      yeoncha_data: {
        Row: {
          created_at: string
          day: number
          id: string
          month: number
          name: string
          year: number
        }
        Insert: {
          created_at?: string
          day: number
          id?: string
          month: number
          name: string
          year: number
        }
        Update: {
          created_at?: string
          day?: number
          id?: string
          month?: number
          name?: string
          year?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
