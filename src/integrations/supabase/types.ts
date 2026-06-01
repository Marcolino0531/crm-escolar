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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      boleto_category_mappings: {
        Row: {
          created_at: string
          id: string
          revenue_category_id: string | null
          revenue_subcategory_id: string | null
          source_label: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          revenue_category_id?: string | null
          revenue_subcategory_id?: string | null
          source_label: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          revenue_category_id?: string | null
          revenue_subcategory_id?: string | null
          source_label?: string
          updated_at?: string
        }
        Relationships: []
      }
      boleto_reconciliation_items: {
        Row: {
          amount: number
          created_at: string
          id: string
          reconciliation_id: string
          revenue_category_id: string | null
          revenue_subcategory_id: string | null
          subcategory_label: string
          transaction_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          reconciliation_id: string
          revenue_category_id?: string | null
          revenue_subcategory_id?: string | null
          subcategory_label: string
          transaction_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          reconciliation_id?: string
          revenue_category_id?: string | null
          revenue_subcategory_id?: string | null
          subcategory_label?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boleto_reconciliation_items_reconciliation_id_fkey"
            columns: ["reconciliation_id"]
            isOneToOne: false
            referencedRelation: "boleto_reconciliations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boleto_reconciliation_items_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      boleto_reconciliations: {
        Row: {
          created_at: string
          id: string
          school_id: string
          source_filename: string | null
          total_amount: number
          transaction_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          school_id: string
          source_filename?: string | null
          total_amount: number
          transaction_id: string
        }
        Update: {
          created_at?: string
          id?: string
          school_id?: string
          source_filename?: string | null
          total_amount?: number
          transaction_id?: string
        }
        Relationships: []
      }
      categorization_rules: {
        Row: {
          cost_center_id: string | null
          created_at: string
          id: string
          keyword: string
          kind: string
          revenue_category_id: string | null
          revenue_subcategory_id: string | null
          sub_cost_center_id: string | null
        }
        Insert: {
          cost_center_id?: string | null
          created_at?: string
          id?: string
          keyword: string
          kind?: string
          revenue_category_id?: string | null
          revenue_subcategory_id?: string | null
          sub_cost_center_id?: string | null
        }
        Update: {
          cost_center_id?: string | null
          created_at?: string
          id?: string
          keyword?: string
          kind?: string
          revenue_category_id?: string | null
          revenue_subcategory_id?: string | null
          sub_cost_center_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "categorization_rules_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categorization_rules_revenue_category_id_fkey"
            columns: ["revenue_category_id"]
            isOneToOne: false
            referencedRelation: "revenue_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categorization_rules_revenue_subcategory_id_fkey"
            columns: ["revenue_subcategory_id"]
            isOneToOne: false
            referencedRelation: "revenue_subcategories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categorization_rules_sub_cost_center_id_fkey"
            columns: ["sub_cost_center_id"]
            isOneToOne: false
            referencedRelation: "sub_cost_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_centers: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      initial_balances: {
        Row: {
          amount: number
          created_at: string
          id: string
          reference_date: string
          school_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          reference_date: string
          school_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          reference_date?: string
          school_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      reconciliations: {
        Row: {
          created_at: string
          id: string
          items_count: number
          notes: string | null
          reconciled_date: string
          school_id: string
          source_filename: string | null
          total_amount: number
        }
        Insert: {
          created_at?: string
          id?: string
          items_count?: number
          notes?: string | null
          reconciled_date: string
          school_id: string
          source_filename?: string | null
          total_amount: number
        }
        Update: {
          created_at?: string
          id?: string
          items_count?: number
          notes?: string | null
          reconciled_date?: string
          school_id?: string
          source_filename?: string | null
          total_amount?: number
        }
        Relationships: []
      }
      recurring_forecasts: {
        Row: {
          cost_center_id: string | null
          created_at: string
          description: string
          due_date: string | null
          id: string
          month: string
          normalized_key: string | null
          notes: string | null
          projected_amount: number
          school_id: string
          series_id: string | null
          status: string
          sub_cost_center_id: string | null
          transaction_id: string | null
          updated_at: string
        }
        Insert: {
          cost_center_id?: string | null
          created_at?: string
          description: string
          due_date?: string | null
          id?: string
          month: string
          normalized_key?: string | null
          notes?: string | null
          projected_amount?: number
          school_id: string
          series_id?: string | null
          status?: string
          sub_cost_center_id?: string | null
          transaction_id?: string | null
          updated_at?: string
        }
        Update: {
          cost_center_id?: string | null
          created_at?: string
          description?: string
          due_date?: string | null
          id?: string
          month?: string
          normalized_key?: string | null
          notes?: string | null
          projected_amount?: number
          school_id?: string
          series_id?: string | null
          status?: string
          sub_cost_center_id?: string | null
          transaction_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_forecasts_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_forecasts_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "recurring_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_forecasts_sub_cost_center_id_fkey"
            columns: ["sub_cost_center_id"]
            isOneToOne: false
            referencedRelation: "sub_cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_forecasts_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_series: {
        Row: {
          cost_center_id: string | null
          created_at: string
          description: string
          due_day: number
          end_month: string | null
          id: string
          notes: string | null
          projected_amount: number
          school_id: string
          skipped_months: string[]
          start_month: string
          sub_cost_center_id: string | null
          updated_at: string
        }
        Insert: {
          cost_center_id?: string | null
          created_at?: string
          description: string
          due_day: number
          end_month?: string | null
          id?: string
          notes?: string | null
          projected_amount?: number
          school_id: string
          skipped_months?: string[]
          start_month: string
          sub_cost_center_id?: string | null
          updated_at?: string
        }
        Update: {
          cost_center_id?: string | null
          created_at?: string
          description?: string
          due_day?: number
          end_month?: string | null
          id?: string
          notes?: string | null
          projected_amount?: number
          school_id?: string
          skipped_months?: string[]
          start_month?: string
          sub_cost_center_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      revenue_categories: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      revenue_subcategories: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          revenue_category_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          revenue_category_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          revenue_category_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_subcategories_revenue_category_id_fkey"
            columns: ["revenue_category_id"]
            isOneToOne: false
            referencedRelation: "revenue_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      schools: {
        Row: {
          created_at: string
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      sub_cost_centers: {
        Row: {
          cost_center_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          cost_center_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          cost_center_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "sub_cost_centers_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          cost_center_id: string | null
          created_at: string
          date: string
          description: string
          id: string
          notes: string | null
          parent_transaction_id: string | null
          revenue_category_id: string | null
          revenue_subcategory_id: string | null
          school_id: string
          sub_cost_center_id: string | null
          type: string
        }
        Insert: {
          amount: number
          cost_center_id?: string | null
          created_at?: string
          date: string
          description: string
          id?: string
          notes?: string | null
          parent_transaction_id?: string | null
          revenue_category_id?: string | null
          revenue_subcategory_id?: string | null
          school_id: string
          sub_cost_center_id?: string | null
          type: string
        }
        Update: {
          amount?: number
          cost_center_id?: string | null
          created_at?: string
          date?: string
          description?: string
          id?: string
          notes?: string | null
          parent_transaction_id?: string | null
          revenue_category_id?: string | null
          revenue_subcategory_id?: string | null
          school_id?: string
          sub_cost_center_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_cost_center_id_fkey"
            columns: ["cost_center_id"]
            isOneToOne: false
            referencedRelation: "cost_centers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_parent_transaction_id_fkey"
            columns: ["parent_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_revenue_category_id_fkey"
            columns: ["revenue_category_id"]
            isOneToOne: false
            referencedRelation: "revenue_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_revenue_subcategory_id_fkey"
            columns: ["revenue_subcategory_id"]
            isOneToOne: false
            referencedRelation: "revenue_subcategories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_school_id_fkey"
            columns: ["school_id"]
            isOneToOne: false
            referencedRelation: "schools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_sub_cost_center_id_fkey"
            columns: ["sub_cost_center_id"]
            isOneToOne: false
            referencedRelation: "sub_cost_centers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_user_roles: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"][]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "viewer"
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
    Enums: {
      app_role: ["admin", "viewer"],
    },
  },
} as const
